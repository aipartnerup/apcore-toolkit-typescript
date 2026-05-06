import type { ModuleAnnotations } from 'apcore-js';
import { DEFAULT_ANNOTATIONS } from 'apcore-js';
import type { ScannedModule } from './types.js';
import { cloneModule } from './types.js';

/**
 * Apply include/exclude regex filters to a list of scanned modules.
 *
 * Module-level free function — the canonical implementation. The
 * {@link BaseScanner.filterModules} instance method delegates here so
 * the package can re-export this directly from `apcore-toolkit/index`
 * for cross-language symbol parity (Python: `apcore_toolkit.filter_modules`,
 * Rust: `apcore_toolkit::filter_modules`).
 *
 * @param modules - Modules to filter.
 * @param include - Optional regex pattern string; only matching module IDs are kept.
 * @param exclude - Optional regex pattern string; matching module IDs are removed.
 * @returns Filtered array of modules.
 * @throws {SyntaxError} When `include` or `exclude` contain an invalid regex pattern.
 */
export function filterModules(
  modules: ScannedModule[],
  include?: string,
  exclude?: string,
): ScannedModule[] {
  let result = modules;

  if (include != null) {
    const re = new RegExp(include);
    result = result.filter((m) => re.test(m.moduleId));
  }

  if (exclude != null) {
    const re = new RegExp(exclude);
    result = result.filter((m) => !re.test(m.moduleId));
  }

  return result;
}

/**
 * Deduplicate module IDs by appending a numeric suffix to colliding entries.
 *
 * Module-level free function — the canonical implementation. The
 * {@link BaseScanner.deduplicateIds} instance method delegates here.
 * Cross-language siblings: Python's ``apcore_toolkit.deduplicate_ids``
 * and Rust's ``apcore_toolkit::deduplicate_ids``.
 */
export function deduplicateIds(modules: ScannedModule[]): ScannedModule[] {
  const seenCount = new Map<string, number>();
  // Pre-populate with all original IDs so generated suffixes never collide
  // with an ID that already exists in the input list.
  const usedIds = new Set<string>(modules.map((m) => m.moduleId));
  const result: ScannedModule[] = [];

  for (const module of modules) {
    const mid = module.moduleId;
    const count = seenCount.get(mid) ?? 0;
    seenCount.set(mid, count + 1);

    if (count > 0) {
      let counter = count + 1;
      let newId = `${mid}_${counter}`;
      while (usedIds.has(newId)) {
        counter++;
        newId = `${mid}_${counter}`;
      }
      usedIds.add(newId);
      result.push(
        cloneModule(module, {
          moduleId: newId,
          warnings: [
            ...module.warnings,
            `Module ID renamed from '${mid}' to '${newId}' to avoid collision`,
          ],
        }),
      );
    } else {
      result.push(module);
    }
  }

  return result;
}


/**
 * Abstract base class for all apcore-toolkit scanners.
 *
 * Subclasses implement `scan()` to produce `ScannedModule[]` from a given
 * source (OpenAPI spec, Express router, file system, etc.).  The base class
 * provides shared utilities: docstring extraction, module ID deduplication,
 * and pattern-based include/exclude filtering.
 *
 * @example
 * class MyScanner extends BaseScanner {
 *   scan(spec: OpenAPISpec): ScannedModule[] { ... }
 *   getSourceName(): string { return 'my-scanner'; }
 * }
 */
export abstract class BaseScanner {
  abstract scan(...args: unknown[]): ScannedModule[] | Promise<ScannedModule[]>;
  abstract getSourceName(): string;

  extractDocstring(func: unknown): {
    description: string | null;
    documentation: string | null;
    params: Record<string, string>;
  } {
    if (func == null || typeof func !== 'function') {
      return { description: null, documentation: null, params: {} };
    }

    // Extract JSDoc-style documentation from function's toString representation
    const source = func.toString();
    const jsdocMatch = source.match(/^\/\*\*([\s\S]*?)\*\//);
    if (!jsdocMatch) {
      return { description: null, documentation: null, params: {} };
    }

    const raw = jsdocMatch[1];
    const lines = raw
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);

    const descLines: string[] = [];
    const params: Record<string, string> = {};
    let hitTag = false;

    for (const line of lines) {
      if (line.startsWith('@param')) {
        hitTag = true;
        const m = line.match(/@param\s+\{?\w*\}?\s*(\w+)\s*(.*)/);
        if (m) params[m[1]] = m[2].replace(/^-\s*/, '').trim();
      } else if (line.startsWith('@')) {
        hitTag = true;
      } else if (!hitTag) {
        descLines.push(line);
      }
    }

    const description = descLines.length > 0 ? descLines[0] : null;
    const documentation = descLines.length > 1 ? descLines.join('\n') : null;

    return { description, documentation, params };
  }

  /**
   * Apply include/exclude regex filters to a list of scanned modules.
   *
   * @param modules - Modules to filter.
   * @param include - Optional regex pattern string; only matching module IDs are kept.
   * @param exclude - Optional regex pattern string; matching module IDs are removed.
   * @returns Filtered array of modules.
   * @throws {SyntaxError} When `include` or `exclude` contain an invalid regex pattern.
   */
  filterModules(
    modules: ScannedModule[],
    include?: string,
    exclude?: string,
  ): ScannedModule[] {
    return filterModules(modules, include, exclude);
  }

  /**
   * Infer behavioural annotations from an HTTP method.
   *
   * Canonical mapping per
   * `apcore-toolkit/docs/features/scanning.md` (RFC 9110 §9.2 safe-method
   * semantics):
   *   GET     → readonly=true, cacheable=true
   *   HEAD    → readonly=true
   *   OPTIONS → readonly=true
   *   PUT     → idempotent=true
   *   DELETE  → destructive=true
   *   Others  → defaults (all false)
   *
   * HEAD and OPTIONS return readonly=true without cacheable=true: those
   * methods are safe by spec but their responses are not generally cacheable
   * for application-level use.
   */
  static inferAnnotationsFromMethod(method: string): ModuleAnnotations {
    if (typeof method !== 'string') return { ...DEFAULT_ANNOTATIONS };
    const upper = method.toUpperCase();

    if (upper === 'GET') {
      return { ...DEFAULT_ANNOTATIONS, readonly: true, cacheable: true };
    }
    if (upper === 'HEAD' || upper === 'OPTIONS') {
      return { ...DEFAULT_ANNOTATIONS, readonly: true };
    }
    if (upper === 'DELETE') {
      return { ...DEFAULT_ANNOTATIONS, destructive: true };
    }
    if (upper === 'PUT') {
      return { ...DEFAULT_ANNOTATIONS, idempotent: true };
    }

    return { ...DEFAULT_ANNOTATIONS };
  }

  deduplicateIds(modules: ScannedModule[]): ScannedModule[] {
    return deduplicateIds(modules);
  }
}
