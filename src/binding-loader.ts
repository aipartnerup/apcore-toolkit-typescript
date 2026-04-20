/**
 * BindingLoader — parse `.binding.yaml` files back into `ScannedModule`.
 *
 * Inverse of {@link YAMLWriter}. Unlike apcore-js's binding loader (which
 * imports the target and creates a runtime `FunctionModule`), this loader
 * is pure data: it parses YAML into `ScannedModule` objects for validation,
 * merging, diffing, or round-trip workflows. No module resolution occurs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ModuleAnnotations, ModuleExample } from 'apcore-js';
import { annotationsFromJSON } from 'apcore-js';
import type { ScannedModule } from './types.js';
import { createScannedModule } from './types.js';
import { PROTO_DENY } from './internal/safe-keys.js';

const SUPPORTED_SPEC_VERSIONS = new Set(['1.0']);
const LOOSE_REQUIRED = ['module_id', 'target'] as const;
const STRICT_EXTRA = ['input_schema', 'output_schema'] as const;
// Cap on directory recursion depth in `_collectRecursive`. This is the
// PRIMARY defense against symlink loops (`a -> b -> a`): `statSync` resolves
// symlinks but does not detect cycles, so a cyclic graph would recurse until
// the JS stack overflows without this cap. Also bounds worst-case stack
// usage on legitimately-deep trees; 64 is well above any realistic
// `.binding.yaml` layout.
const MAX_RECURSION_DEPTH = 64;

/** Options for {@link BindingLoader} methods. */
export interface BindingLoadOptions {
  /**
   * When `true`, also require `input_schema` and `output_schema`.
   * Default: `false` (loose mode — only `module_id` and `target` required).
   */
  strict?: boolean;
  /**
   * When `true` and the path is a directory, recursively walk subdirectories
   * to find all `**\/*.binding.yaml` files. When `false` (default), only files
   * in the immediate directory are loaded (flat glob behaviour).
   */
  recursive?: boolean;
}

/** Thrown when a binding YAML entry cannot be parsed. */
export class BindingLoadError extends Error {
  filePath: string | null;
  moduleId: string | null;
  missingFields: string[];
  reason: string;

  constructor(params: {
    reason: string;
    filePath?: string | null;
    moduleId?: string | null;
    missingFields?: string[];
  }) {
    const parts = [params.reason];
    if (params.filePath) parts.push(`file=${params.filePath}`);
    if (params.moduleId) parts.push(`module_id=${params.moduleId}`);
    if (params.missingFields && params.missingFields.length > 0) {
      parts.push(`missing=[${params.missingFields.join(', ')}]`);
    }
    super(parts.join(' | '));
    this.name = 'BindingLoadError';
    this.reason = params.reason;
    this.filePath = params.filePath ?? null;
    this.moduleId = params.moduleId ?? null;
    this.missingFields = params.missingFields ?? [];
  }
}

/**
 * Loads `.binding.yaml` files into `ScannedModule` objects.
 *
 * @example
 * ```ts
 * const loader = new BindingLoader();
 * const modules = loader.load('./bindings/');
 * const strict = loader.load('foo.binding.yaml', { strict: true });
 * ```
 */
export class BindingLoader {
  /**
   * Load one file or every `*.binding.yaml` in a directory.
   *
   * @throws {BindingLoadError} when the path is missing, YAML is malformed,
   *   or any entry fails validation.
   */
  load(filePath: string, options?: BindingLoadOptions): ScannedModule[] {
    const strict = options?.strict ?? false;
    const recursive = options?.recursive ?? false;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (exc) {
      const code = (exc as NodeJS.ErrnoException).code;
      const reason =
        code === 'ENOENT'
          ? 'path does not exist'
          : `cannot stat path (${code ?? 'unknown'})`;
      throw new BindingLoadError({ reason, filePath });
    }

    let files: string[];
    if (stat.isFile()) {
      files = [filePath];
    } else if (stat.isDirectory()) {
      if (recursive) {
        files = this._collectRecursive(filePath).sort();
      } else {
        files = fs
          .readdirSync(filePath)
          .filter((f) => f.endsWith('.binding.yaml'))
          .sort()
          .map((f) => path.join(filePath, f));
      }
    } else {
      throw new BindingLoadError({
        reason: 'path is neither a file nor a directory',
        filePath,
      });
    }

    const modules: ScannedModule[] = [];
    for (const f of files) {
      let content: string;
      try {
        content = fs.readFileSync(f, 'utf-8');
      } catch (exc) {
        throw new BindingLoadError({
          reason: `failed to read file: ${(exc as Error).message}`,
          filePath: f,
        });
      }
      let raw: unknown;
      try {
        raw = yaml.load(content);
      } catch (exc) {
        throw new BindingLoadError({
          reason: `failed to parse YAML: ${(exc as Error).message}`,
          filePath: f,
        });
      }
      if (raw == null) {
        console.warn(`BindingLoader: ${f} is empty, skipping`);
        continue;
      }
      modules.push(...this._parseDocument(raw, f, strict));
    }
    return modules;
  }

  /** Parse a pre-loaded binding dict (`{ bindings: [...] }`). */
  loadData(data: Record<string, unknown>, options?: BindingLoadOptions): ScannedModule[] {
    return this._parseDocument(data, null, options?.strict ?? false);
  }

  // --------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------

  /**
   * Recursively collect `.binding.yaml` files under `dir`. Follows symlinks
   * (for parity with the non-recursive branch, which reads file contents and
   * thus transparently dereferences symlinks) and caps recursion at
   * {@link MAX_RECURSION_DEPTH}. Permission errors (`EACCES`/`EPERM`) on an
   * individual subdirectory are swallowed with a warning so one unreadable
   * subtree does not abort loading of the rest; all other `readdirSync`
   * failures (e.g. `EMFILE`, `ENOTDIR`) propagate so systemic problems are
   * not silently turned into partial loads.
   */
  private _collectRecursive(dir: string, depth = 0): string[] {
    if (depth > MAX_RECURSION_DEPTH) {
      console.warn(
        `BindingLoader: max recursion depth (${MAX_RECURSION_DEPTH}) reached at ${dir}; stopping descent.`,
      );
      return [];
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (exc) {
      const code = (exc as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        console.warn(
          `BindingLoader: cannot read ${dir}: ${(exc as Error).message}; skipping`,
        );
        return [];
      }
      throw exc;
    }
    const results: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      // Dirent.isDirectory/isFile both return false for symlinks; follow the
      // link with stat so symlinked bindings / bindings-dirs behave the same
      // as real ones (matching non-recursive-branch behaviour).
      if (entry.isSymbolicLink()) {
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        results.push(...this._collectRecursive(full, depth + 1));
      } else if (isFile && entry.name.endsWith('.binding.yaml')) {
        results.push(full);
      }
    }
    return results;
  }

  private _parseDocument(
    raw: unknown,
    filePath: string | null,
    strict: boolean,
  ): ScannedModule[] {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BindingLoadError({
        reason: 'top-level binding document must be a mapping',
        filePath,
      });
    }
    const data = raw as Record<string, unknown>;
    this._checkSpecVersion(data['spec_version'], filePath);

    const bindings = data['bindings'];
    if (!Array.isArray(bindings)) {
      throw new BindingLoadError({
        reason: "'bindings' key missing or not a list",
        filePath,
      });
    }

    return bindings.map((entry) => {
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new BindingLoadError({
          reason: 'binding entry must be a mapping',
          filePath,
        });
      }
      return this._parseEntry(entry as Record<string, unknown>, filePath, strict);
    });
  }

  private _checkSpecVersion(specVersion: unknown, filePath: string | null): void {
    const where = filePath ?? '<inline>';
    if (specVersion == null) {
      console.warn(`BindingLoader: ${where} missing 'spec_version'; defaulting to '1.0'.`);
      return;
    }
    if (typeof specVersion !== 'string' || !SUPPORTED_SPEC_VERSIONS.has(specVersion)) {
      console.warn(
        `BindingLoader: ${where} has spec_version=${JSON.stringify(specVersion)} ` +
          `newer than supported [${[...SUPPORTED_SPEC_VERSIONS].sort().join(', ')}]; proceeding best-effort.`,
      );
    }
  }

  private _parseEntry(
    entry: Record<string, unknown>,
    filePath: string | null,
    strict: boolean,
  ): ScannedModule {
    const required: readonly string[] = strict
      ? [...LOOSE_REQUIRED, ...STRICT_EXTRA]
      : LOOSE_REQUIRED;
    const missing = required.filter((f) => !(f in entry) || entry[f] == null);
    if (missing.length > 0) {
      throw new BindingLoadError({
        reason: 'missing required fields',
        filePath,
        moduleId: typeof entry['module_id'] === 'string' ? entry['module_id'] : null,
        missingFields: missing,
      });
    }

    const moduleId = String(entry['module_id']);
    return createScannedModule({
      moduleId,
      description: (entry['description'] as string | undefined) ?? '',
      inputSchema: this._asRecord(entry['input_schema'], 'input_schema', moduleId),
      outputSchema: this._asRecord(entry['output_schema'], 'output_schema', moduleId),
      tags: this._asStringArray(entry['tags']),
      target: String(entry['target']),
      version: (entry['version'] as string | undefined) ?? '1.0.0',
      annotations: this._parseAnnotations(entry['annotations'], moduleId),
      documentation: (entry['documentation'] as string | null | undefined) ?? null,
      suggestedAlias: (entry['suggested_alias'] as string | null | undefined) ?? null,
      examples: this._parseExamples(entry['examples'], moduleId),
      metadata: this._asRecord(entry['metadata'], 'metadata', moduleId),
      display: this._asRecordOrNull(entry['display'], 'display', moduleId),
      warnings: this._asStringArray(entry['warnings']),
    });
  }

  /**
   * Parse a field expected to be a mapping. When the value is present but is
   * not a mapping (e.g. a string or array from user-edited YAML), emit a
   * warning and fall back to an empty record so the malformed data does not
   * silently persist through round-trip.
   */
  private static readonly _PROTO_DENY = PROTO_DENY;

  private _asRecord(value: unknown, fieldName: string, moduleId: string): Record<string, unknown> {
    if (value == null) return {};
    if (typeof value === 'object' && !Array.isArray(value)) {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!BindingLoader._PROTO_DENY.has(k)) safe[k] = v;
      }
      return safe;
    }
    console.warn(
      `BindingLoader: ${fieldName} for module ${moduleId} is not a dict (${typeof value}); using empty {}`,
    );
    return {};
  }

  /**
   * Same as {@link _asRecord}, but returns `null` for absent values
   * (used for optional fields like `display`).
   */
  private _asRecordOrNull(
    value: unknown,
    fieldName: string,
    moduleId: string,
  ): Record<string, unknown> | null {
    if (value == null) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const src = value as Record<string, unknown>;
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) {
        if (!BindingLoader._PROTO_DENY.has(k)) filtered[k] = v;
      }
      return structuredClone(filtered);
    }
    console.warn(
      `BindingLoader: ${fieldName} for module ${moduleId} is not a dict (${typeof value}); treating as null`,
    );
    return null;
  }

  private _asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  private _parseAnnotations(value: unknown, moduleId: string): ModuleAnnotations | null {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
      console.warn(
        `BindingLoader: annotations for module ${moduleId} is not a dict; treating as null`,
      );
      return null;
    }
    try {
      return annotationsFromJSON(value as Record<string, unknown>);
    } catch (exc) {
      console.warn(
        `BindingLoader: failed to parse annotations for module ${moduleId}: ${
          (exc as Error).message
        }; treating as null`,
      );
      return null;
    }
  }

  private _parseExamples(value: unknown, moduleId: string): ModuleExample[] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      console.warn(`BindingLoader: examples for module ${moduleId} is not a list; ignoring`);
      return [];
    }
    const result: ModuleExample[] = [];
    value.forEach((ex, i) => {
      if (ex == null || typeof ex !== 'object' || Array.isArray(ex)) {
        console.warn(
          `BindingLoader: examples[${i}] of module ${moduleId} is not a dict; ignoring`,
        );
        return;
      }
      // Deep clone so caller mutation of the returned ScannedModule's
      // examples cannot leak back into the parsed YAML source graph.
      result.push(structuredClone(ex) as ModuleExample);
    });
    return result;
  }
}
