/**
 * OpenAPIScanner — turn an OpenAPI 3.x document into a `ScannedModule[]`.
 *
 * Document-level traversal layered on top of the shipped operation-level
 * primitives in `./openapi.js` (`extractInputSchema`, `extractOutputSchema`,
 * `resolveRef`) and `BaseScanner.inferAnnotationsFromMethod`.
 *
 * Pure and synchronous — no I/O. See `./openapi-loader.js` for the
 * (Node-only) `loadSpec` convenience helper, which is intentionally kept in
 * a separate file so this module stays importable from
 * `apcore-toolkit/browser` (see `src/browser/index.ts`).
 *
 * See `apcore-toolkit/docs/features/openapi-scanner.md` for the full V1
 * specification, worked examples, and conformance corpus.
 */

import { BaseScanner } from './scanner.js';
import type { ScannedModule } from './types.js';
import { createScannedModule } from './types.js';
import { extractInputSchema, extractOutputSchema, resolveRef } from './openapi.js';

/**
 * Thrown by {@link OpenAPIScanner.scan} when the input document is not a
 * recognisable OpenAPI 3.0.x/3.1.x document (missing `openapi` key, or an
 * OpenAPI 2.0 / Swagger document). Matches the doc's Contract: "TypeScript
 * throws `InvalidSpecError`".
 */
export class InvalidSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSpecError';
  }
}

// Only these path-item keys are treated as HTTP operations (OpenAPI 3.x Path
// Item Object). Everything else (`summary`, `parameters`, `servers`, `$ref`,
// vendor `x-*` extensions, ...) is skipped.
const RECOGNIZED_METHODS: ReadonlySet<string> = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

// The `u` flag makes this regex operate on Unicode CODE POINTS rather than
// UTF-16 code UNITS. Without it, a non-BMP character (e.g. an emoji, encoded
// as a UTF-16 surrogate pair) would be matched — and replaced with `_` —
// once per surrogate half, producing two underscores where Python's
// code-point-based `re` and Rust's Unicode-scalar-based `regex` crate each
// produce exactly one. That would break the documented byte-for-byte
// cross-SDK `derive_module_id` guarantee. DOT_RUN_RE and the leading/
// trailing trim regexes below only ever match ASCII `.`/`_`, which are
// single code units regardless of surrounding astral characters, so they
// don't need the flag.
const SANITIZE_RE = /[^A-Za-z0-9_.-]/gu;
const DOT_RUN_RE = /\.+/g;

/**
 * Sanitize a module-id candidate per the `deriveModuleId` algorithm.
 *
 * Replace every character not in `[A-Za-z0-9_.-]` with `_`, collapse runs of
 * `.` into a single `.`, then strip leading/trailing `.` and `_`.
 */
function sanitize(candidate: string): string {
  let s = candidate.replace(SANITIZE_RE, '_');
  s = s.replace(DOT_RUN_RE, '.');
  return s.replace(/^[._]+/, '').replace(/[._]+$/, '');
}

/**
 * Derive a stable, byte-identical `moduleId` for an OpenAPI operation.
 *
 * See `apcore-toolkit/docs/features/openapi-scanner.md` § `module_id`
 * Derivation for the algorithm and worked examples. This function is the
 * primary subject of the cross-SDK conformance corpus — implementations
 * MUST match it byte-for-byte.
 *
 * @param path - The OpenAPI path template (e.g. `"/users/{user_id}"`).
 * @param method - The HTTP method key as written in the document (e.g. `"get"`).
 * @param operation - The operation object, consulted only for `operationId`.
 * @returns The derived module ID. Never empty — falls back to `"root.<method>"`.
 */
export function deriveModuleId(
  path: string,
  method: string,
  operation: Record<string, unknown>,
): string {
  const operationId = operation['operationId'];
  if (typeof operationId === 'string' && operationId !== '') {
    const candidate = sanitize(operationId);
    if (candidate) return candidate;
  }

  const rawSegments = path.split('/').filter((seg) => seg !== '');
  if (rawSegments.length === 0) {
    return `root.${method.toLowerCase()}`;
  }

  const segments = rawSegments.map((seg) =>
    seg.length >= 2 && seg.startsWith('{') && seg.endsWith('}') ? seg.slice(1, -1) : seg,
  );

  let candidate = [...segments, method].join('.').toLowerCase();
  candidate = sanitize(candidate);
  if (!candidate) {
    return `root.${method.toLowerCase()}`;
  }
  return candidate;
}

/** Depth-first collect every `$ref` string appearing under `node`. */
function collectRefs(node: unknown): string[] {
  const refs: string[] = [];
  if (Array.isArray(node)) {
    for (const item of node) refs.push(...collectRefs(item));
  } else if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const ref = obj['$ref'];
    if (typeof ref === 'string') refs.push(ref);
    for (const value of Object.values(obj)) refs.push(...collectRefs(value));
  }
  return refs;
}

/**
 * Warn on unresolvable internal refs and refuse external refs.
 *
 * Internal refs (`#/...`) that resolve successfully are silent — this only
 * flags the failure cases enumerated in the Error Model: unresolvable
 * internal `$ref` and external `$ref` (never fetched).
 */
function refWarnings(operation: Record<string, unknown>, spec: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const refs = [
    ...collectRefs(operation['requestBody'] ?? {}),
    ...collectRefs(operation['responses'] ?? {}),
  ];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (!ref.startsWith('#/')) {
      warnings.push(`external $ref not fetched: ${ref}`);
    } else if (Object.keys(resolveRef(ref, spec)).length === 0) {
      warnings.push(`unresolvable $ref: ${ref}`);
    }
  }
  return warnings;
}

function firstLine(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (stripped) return stripped;
  }
  return null;
}

const ABS_URL_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const TEMPLATE_VAR_RE = /\{([^}]+)\}/g;

/**
 * Best-effort resolution of `servers[0].url`.
 *
 * Absolute URLs are used verbatim. Templated URLs are substituted from
 * `servers[0].variables[*].default` when every variable has one; otherwise
 * the URL is unusable and omitted. Relative URLs require the spec's
 * *source* URL to resolve against, which `scan()` — pure and I/O-free —
 * does not have; they are omitted here (advisory only; the caller supplies
 * `baseUrl` to the writer regardless).
 */
function resolveServerUrl(spec: Record<string, unknown>): string | null {
  const servers = spec['servers'];
  if (!Array.isArray(servers) || servers.length === 0) return null;
  const first = servers[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null;
  const firstObj = first as Record<string, unknown>;
  const url = firstObj['url'];
  if (typeof url !== 'string' || url === '') return null;
  if (!ABS_URL_RE.test(url)) return null;

  let resultUrl = url;
  const variables = firstObj['variables'];
  if (
    variables !== null &&
    typeof variables === 'object' &&
    !Array.isArray(variables) &&
    Object.keys(variables as Record<string, unknown>).length > 0
  ) {
    const varsObj = variables as Record<string, unknown>;
    const substitutions: Record<string, string> = {};
    for (const [name, v] of Object.entries(varsObj)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v) || !('default' in v)) {
        return null;
      }
      substitutions[name] = String((v as Record<string, unknown>)['default']);
    }
    resultUrl = resultUrl.replace(TEMPLATE_VAR_RE, (match, varName: string) => substitutions[varName] ?? match);
    if (resultUrl.includes('{') || resultUrl.includes('}')) return null;
  }

  return resultUrl;
}

function validateSpec(spec: unknown): asserts spec is Record<string, unknown> {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new InvalidSpecError('OpenAPIScanner.scan: spec must be an object');
  }
  const openapiVersion = (spec as Record<string, unknown>)['openapi'];
  if (
    typeof openapiVersion !== 'string' ||
    !(openapiVersion.startsWith('3.0') || openapiVersion.startsWith('3.1'))
  ) {
    throw new InvalidSpecError(
      'OpenAPIScanner.scan: unsupported spec — expected OpenAPI 3.0.x or 3.1.x, ' +
        `got 'openapi': ${JSON.stringify(openapiVersion ?? null)} (swagger 2.0 is not supported in V1)`,
    );
  }
}

/**
 * Options for {@link OpenAPIScanner.scan}. See
 * `apcore-toolkit/docs/features/openapi-scanner.md` § Contract:
 * OpenAPIScanner.scan and § Extension Hooks.
 */
export interface OpenAPIScanOptions {
  /** Regex forwarded to `filterModules`; only matching module IDs are kept. */
  include?: string;
  /** Regex forwarded to `filterModules`; matching module IDs are removed. */
  exclude?: string;
  /** Prepended to every derived `moduleId` as `"<prefix>.<id>"`, before filtering/dedup. */
  basePathPrefix?: string;
  /** When `false`, operations with `deprecated: true` are omitted entirely. Default `true`. */
  includeDeprecated?: boolean;
  /** Patch or normalise an operation before extraction. Returning `null` skips it entirely. */
  transformOperation?: (
    path: string,
    method: string,
    operation: Record<string, unknown>,
  ) => Record<string, unknown> | null;
  /** Override the naming algorithm. Returning `null` falls back to {@link deriveModuleId}. */
  deriveModuleId?: (path: string, method: string, operation: Record<string, unknown>) => string | null;
  /** Adjust the finished module. Returning `null` drops it from the result. */
  transformModule?: (module: ScannedModule) => ScannedModule | null;
}

/**
 * Turn an OpenAPI 3.0/3.1 document into a list of `ScannedModule`.
 *
 * Pure and synchronous: `scan()` accepts an already-parsed document and
 * performs no I/O. Use `loadSpec` (from `./openapi-loader.js`) to
 * fetch/parse a document first.
 */
export class OpenAPIScanner extends BaseScanner {
  scan(spec: Record<string, unknown>, options: OpenAPIScanOptions = {}): ScannedModule[] {
    validateSpec(spec);

    const {
      include,
      exclude,
      basePathPrefix,
      includeDeprecated = true,
      transformOperation,
      deriveModuleId: deriveModuleIdHook,
      transformModule,
    } = options;

    const rawPaths = spec['paths'];
    const paths =
      rawPaths !== null && typeof rawPaths === 'object' && !Array.isArray(rawPaths)
        ? (rawPaths as Record<string, unknown>)
        : {};

    const openapiVersion = spec['openapi'];
    const info = spec['info'];
    const infoVersion =
      info !== null && typeof info === 'object' && !Array.isArray(info)
        ? (info as Record<string, unknown>)['version']
        : undefined;
    const docVersion = typeof infoVersion === 'string' && infoVersion ? infoVersion : '1.0.0';
    const serverUrl = resolveServerUrl(spec);

    let modules: ScannedModule[] = [];

    for (const [path, rawPathItem] of Object.entries(paths)) {
      if (typeof rawPathItem !== 'object' || rawPathItem === null || Array.isArray(rawPathItem)) continue;
      const pathItem = rawPathItem as Record<string, unknown>;

      for (const [key, rawOperation] of Object.entries(pathItem)) {
        const method = key.toLowerCase();
        if (
          !RECOGNIZED_METHODS.has(method) ||
          typeof rawOperation !== 'object' ||
          rawOperation === null ||
          Array.isArray(rawOperation)
        ) {
          continue;
        }

        let operation = rawOperation as Record<string, unknown>;

        if (transformOperation) {
          const transformed = transformOperation(path, method, operation);
          if (transformed === null) continue;
          operation = transformed;
        }

        // Strict boolean check (not truthy coercion): OpenAPI's `deprecated`
        // is typed `boolean` in the spec, so a malformed non-boolean value
        // (e.g. the string `"false"`) should not flip this on. Matches
        // Rust's `and_then(Value::as_bool)` behavior.
        const deprecated = operation['deprecated'] === true;
        if (deprecated && !includeDeprecated) continue;

        let mid = deriveModuleIdHook ? deriveModuleIdHook(path, method, operation) : null;
        if (mid === null || mid === undefined) {
          mid = deriveModuleId(path, method, operation);
        }
        if (basePathPrefix) {
          mid = `${basePathPrefix}.${mid}`;
        }

        const warnings = refWarnings(operation, spec);

        const inputSchema = extractInputSchema(operation, spec);
        const outputSchema = extractOutputSchema(operation, spec);
        const responses = operation['responses'];
        const hasSuccess =
          responses !== null && typeof responses === 'object' && !Array.isArray(responses)
            ? Object.keys(responses as Record<string, unknown>).some((status) => /^2\d\d$/.test(status))
            : false;
        if (!hasSuccess) {
          warnings.push('no 2xx response defined; output_schema is empty');
        }

        let annotations = BaseScanner.inferAnnotationsFromMethod(method);
        if (deprecated) {
          // ModuleAnnotations has no first-class `deprecated` field; the
          // toolkit convention is `annotations.extra.deprecated` (see also
          // tui-view-model.ts's Filter.deprecated handling).
          annotations = { ...annotations, extra: { ...annotations.extra, deprecated: true } };
        }

        const summaryVal = operation['summary'];
        const summary = typeof summaryVal === 'string' && summaryVal ? summaryVal : null;
        const descriptionVal = operation['description'];
        const documentation = typeof descriptionVal === 'string' ? descriptionVal : null;
        const description = summary ?? firstLine(documentation) ?? '';

        const openapiMeta: Record<string, unknown> = { spec_version: openapiVersion };
        const operationIdVal = operation['operationId'];
        if (typeof operationIdVal === 'string' && operationIdVal) {
          openapiMeta['operation_id'] = operationIdVal;
        }
        if (serverUrl) {
          openapiMeta['server_url'] = serverUrl;
        }
        if (summary) {
          openapiMeta['summary'] = summary;
        }

        const rawTags = operation['tags'];
        const tags = Array.isArray(rawTags)
          ? rawTags.filter((t): t is string => typeof t === 'string')
          : [];

        let module: ScannedModule = createScannedModule({
          moduleId: mid,
          description,
          inputSchema,
          outputSchema,
          tags,
          target: `${method.toUpperCase()} ${path}`,
          version: docVersion,
          annotations,
          documentation,
          metadata: {
            http_method: method.toUpperCase(),
            url_path: path,
            openapi: openapiMeta,
          },
          warnings,
        });

        if (transformModule) {
          const transformed = transformModule(module);
          if (transformed === null) continue;
          module = transformed;
        }

        modules.push(module);
      }
    }

    modules = this.filterModules(modules, include, exclude);
    modules = this.deduplicateIds(modules);
    return modules;
  }

  getSourceName(): string {
    return 'openapi';
  }
}
