/**
 * DisplayResolver — sparse binding.yaml display overlay.
 *
 * Resolves surface-facing presentation fields (alias, description, guidance)
 * for each ScannedModule by merging:
 *   surface-specific override > display default > binding-level > scanner value
 *
 * The resolved fields are stored in ScannedModule.metadata["display"] and
 * travel through RegistryWriter into FunctionModule.metadata["display"],
 * where CLI/MCP/A2A surfaces read them at render time.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ScannedModule } from '../types.js';
import { cloneModule } from '../types.js';
import { PROTO_DENY } from '../safe-keys.js';

const MCP_ALIAS_MAX = 64;
const MCP_ALIAS_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const CLI_ALIAS_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Surface-specific resolved display fields. */
export interface SurfaceDisplay {
  alias: string;
  description: string;
  guidance: string | null;
}

/** Full resolved display metadata. */
export interface DisplayMetadata {
  alias: string;
  description: string;
  documentation: string | null;
  guidance: string | null;
  tags: string[];
  cli: SurfaceDisplay;
  mcp: SurfaceDisplay;
  a2a: SurfaceDisplay;
}

/** Options for {@link DisplayResolver.resolve}. */
export interface DisplayResolveOptions {
  /**
   * Path to a single `.binding.yaml` file or a directory containing
   * `*.binding.yaml` files. Ignored when `bindingData` is provided.
   */
  bindingPath?: string;

  /**
   * Pre-parsed binding YAML content as an object (`{ bindings: [...] }`)
   * or a `moduleId → entry` map. Takes precedence over `bindingPath`.
   */
  bindingData?: Record<string, unknown>;
}

type BindingEntry = Record<string, unknown>;
type BindingMap = Record<string, BindingEntry>;

/**
 * Resolves display overlay fields for a list of ScannedModules.
 *
 * @example
 * ```ts
 * const resolver = new DisplayResolver();
 * const resolved = resolver.resolve(scannedModules, {
 *   bindingPath: './bindings/',
 * });
 * ```
 */
export class DisplayResolver {
  /**
   * Apply display overlay to a list of ScannedModules.
   *
   * @param modules - ScannedModule instances from a framework scanner.
   * @param options - Optional binding path or pre-parsed binding data.
   * @returns New ScannedModule list with `metadata["display"]` populated.
   */
  resolve(modules: ScannedModule[], options?: DisplayResolveOptions): ScannedModule[] {
    const bindingPath = options?.bindingPath ?? null;
    const bindingData = options?.bindingData ?? null;

    const bindingMap = this._buildBindingMap(bindingPath, bindingData);

    if (Object.keys(bindingMap).length > 0) {
      const matched = modules.filter((mod) => mod.moduleId in bindingMap).length;
      console.info(
        `DisplayResolver: ${matched}/${modules.length} modules matched binding entries.`,
      );
      if (matched === 0) {
        console.warn(
          `DisplayResolver: binding map loaded ${Object.keys(bindingMap).length} entries but none matched ` +
            'any scanned module_id — check binding.yaml module_id values.',
        );
      }
    }

    return modules.map((mod) => this._resolveOne(mod, bindingMap));
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private _buildBindingMap(
    bindingPath: string | null,
    bindingData: Record<string, unknown> | null,
  ): BindingMap {
    if (bindingData != null) {
      return this._parseBindingData(bindingData);
    }
    if (bindingPath != null) {
      return this._loadBindingFiles(bindingPath);
    }
    return {};
  }

  private _parseBindingData(data: Record<string, unknown>): BindingMap {
    // Accept either { bindings: [...] } or a direct moduleId → entry map.
    // Use Object.create(null) so that user-controlled keys like '__proto__'
    // cannot pollute Object.prototype.
    if ('bindings' in data) {
      const rawBindings = data['bindings'];
      if (!Array.isArray(rawBindings)) {
        console.warn('DisplayResolver: bindings must be an array, got', typeof rawBindings);
        return Object.create(null) as BindingMap;
      }
      const bindings = rawBindings as Array<Record<string, unknown>>;
      const result: BindingMap = Object.create(null) as BindingMap;
      for (const entry of bindings) {
        const id = entry['module_id'] as string | undefined;
        if (id != null && !PROTO_DENY.has(id)) {
          result[id] = entry;
        }
      }
      return result;
    }
    // Already a map
    const result: BindingMap = Object.create(null) as BindingMap;
    for (const [k, v] of Object.entries(data)) {
      if (PROTO_DENY.has(k)) continue;
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        result[k] = v as BindingEntry;
      }
    }
    return result;
  }

  private _loadBindingFiles(bindingPath: string): BindingMap {
    const result: BindingMap = Object.create(null) as BindingMap;

    let files: string[] = [];
    try {
      const stat = fs.statSync(bindingPath);
      if (stat.isFile()) {
        files = [bindingPath];
      } else if (stat.isDirectory()) {
        files = fs
          .readdirSync(bindingPath)
          .filter((f) => f.endsWith('.binding.yaml'))
          .sort()
          .map((f) => path.join(bindingPath, f));
      }
    } catch {
      console.warn(`DisplayResolver: binding path not found: ${bindingPath}`);
      return Object.create(null) as BindingMap;
    }

    for (const f of files) {
      let content: string;
      try {
        content = fs.readFileSync(f, 'utf-8');
      } catch (exc) {
        console.warn(`DisplayResolver: failed to read ${f}: ${exc}`);
        continue;
      }
      try {
        const data = (yaml.load(content) as Record<string, unknown>) ?? {};
        Object.assign(result, this._parseBindingData(data));
      } catch (exc) {
        console.warn(`DisplayResolver: failed to parse ${f}: ${exc}`);
      }
    }

    return result;
  }

  /**
   * Resolve display fields for a single ScannedModule.
   *
   * `suggestedAlias` is read from two sources in priority order:
   *   1. `mod.suggestedAlias` (top-level field, preferred)
   *   2. `mod.metadata["suggested_alias"]` (legacy fallback)
   *
   * The top-level field takes precedence when set to a truthy value.
   */
  private static _asStr(val: unknown): string | undefined {
    return typeof val === 'string' ? val : undefined;
  }

  private static _asObj(val: unknown): Record<string, unknown> {
    return val !== null && typeof val === 'object' && !Array.isArray(val)
      ? (val as Record<string, unknown>)
      : {};
  }

  private static _asStrArray(val: unknown, fallback: readonly string[]): string[] {
    if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
    return [...fallback];
  }

  private _resolveOne(mod: ScannedModule, bindingMap: BindingMap): ScannedModule {
    const entry = bindingMap[mod.moduleId] ?? {};
    const displayCfg = DisplayResolver._asObj(entry['display']);
    const bindingDesc = DisplayResolver._asStr(entry['description']);
    const bindingDocs = DisplayResolver._asStr(entry['documentation']);
    const fieldAlias = (mod as { suggestedAlias?: string | null }).suggestedAlias ?? null;
    const metaAlias = (mod.metadata?.['suggested_alias'] as string | undefined) ?? null;
    const suggestedAlias: string | null = fieldAlias || metaAlias;

    // -- Resolve cross-surface defaults --
    const defaultAlias: string =
      DisplayResolver._asStr(displayCfg['alias']) || suggestedAlias || mod.moduleId;
    const defaultDescription: string =
      DisplayResolver._asStr(displayCfg['description']) || bindingDesc || mod.description;
    const defaultDocumentation: string | null =
      DisplayResolver._asStr(displayCfg['documentation']) || bindingDocs || mod.documentation || null;
    const defaultGuidance: string | null = DisplayResolver._asStr(displayCfg['guidance']) || null;
    const resolvedTags: string[] = displayCfg['tags'] !== undefined
      ? DisplayResolver._asStrArray(displayCfg['tags'], mod.tags)
      : DisplayResolver._asStrArray(entry['tags'] !== undefined ? entry['tags'] : mod.tags, mod.tags);

    // -- Resolve per-surface fields --
    const resolveSurface = (
      key: string,
    ): { surface: SurfaceDisplay; aliasExplicit: boolean } => {
      const sc = DisplayResolver._asObj(displayCfg[key]);
      const aliasExplicit = Boolean(DisplayResolver._asStr(sc['alias']));
      return {
        surface: {
          alias: DisplayResolver._asStr(sc['alias']) || defaultAlias,
          description: DisplayResolver._asStr(sc['description']) || defaultDescription,
          guidance: DisplayResolver._asStr(sc['guidance']) || defaultGuidance,
        },
        aliasExplicit,
      };
    };

    const { surface: cliSurface, aliasExplicit: cliAliasExplicit } = resolveSurface('cli');
    const { surface: mcpSurface } = resolveSurface('mcp');
    const { surface: a2aSurface } = resolveSurface('a2a');

    // Auto-sanitize MCP alias: replace non-[a-zA-Z0-9_-] chars with _,
    // then prepend _ if the result starts with a digit.
    const rawMcpAlias = mcpSurface.alias;
    let sanitized = rawMcpAlias.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (sanitized.length > 0 && /^\d/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }
    mcpSurface.alias = sanitized;
    if (sanitized !== rawMcpAlias) {
      console.debug(
        `Module '${mod.moduleId}': MCP alias auto-sanitized '${rawMcpAlias}' → '${sanitized}'.`,
      );
    }

    const display: DisplayMetadata = {
      alias: defaultAlias,
      description: defaultDescription,
      documentation: defaultDocumentation,
      guidance: defaultGuidance,
      tags: resolvedTags,
      cli: cliSurface,
      mcp: mcpSurface,
      a2a: a2aSurface,
    };

    // -- Validate aliases --
    this._validateAliases(display, mod.moduleId, cliAliasExplicit);

    const newMetadata = { ...mod.metadata, display };
    return cloneModule(mod, { metadata: newMetadata });
  }

  private _validateAliases(
    display: DisplayMetadata,
    moduleId: string,
    cliAliasExplicit: boolean,
  ): void {
    // MCP: MUST enforce 64-char hard limit (alias was already auto-sanitized)
    const mcpAlias = display.mcp.alias;
    if (mcpAlias.length > MCP_ALIAS_MAX) {
      throw new Error(
        `Module '${moduleId}': MCP alias '${mcpAlias}' exceeds ` +
          `${MCP_ALIAS_MAX}-character hard limit (OpenAI spec). ` +
          'Set display.mcp.alias to a shorter value.',
      );
    }
    if (!MCP_ALIAS_PATTERN.test(mcpAlias)) {
      throw new Error(
        `Module '${moduleId}': MCP alias '${mcpAlias}' does not match ` +
          'required pattern ^[a-zA-Z_][a-zA-Z0-9_-]*$.',
      );
    }

    // CLI: only validate user-explicitly-set aliases
    if (cliAliasExplicit) {
      const cliAlias = display.cli.alias;
      if (!CLI_ALIAS_PATTERN.test(cliAlias)) {
        console.warn(
          `Module '${moduleId}': CLI alias '${cliAlias}' does not match shell-safe pattern ` +
            `^[a-z][a-z0-9_-]*$ — falling back to default alias '${display.alias}'.`,
        );
        display.cli.alias = display.alias;
      }
    }
  }
}
