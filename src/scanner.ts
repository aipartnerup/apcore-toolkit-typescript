import type { ModuleAnnotations } from 'apcore-js';
import { DEFAULT_ANNOTATIONS } from 'apcore-js';
import type { ScannedModule } from './types.js';
import { cloneModule } from './types.js';


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
    const jsdocMatch = source.match(/\/\*\*([\s\S]*?)\*\//);
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

  filterModules(
    modules: ScannedModule[],
    options?: { include?: string; exclude?: string },
  ): ScannedModule[] {
    let result = modules;

    if (options?.include != null) {
      const re = new RegExp(options.include);
      result = result.filter((m) => re.test(m.moduleId));
    }

    if (options?.exclude != null) {
      const re = new RegExp(options.exclude);
      result = result.filter((m) => !re.test(m.moduleId));
    }

    return result;
  }

  static inferAnnotationsFromMethod(method: string): ModuleAnnotations {
    const upper = method.toUpperCase();

    if (upper === 'GET') {
      return { ...DEFAULT_ANNOTATIONS, readonly: true, cacheable: true };
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
    const seen = new Map<string, number>();
    const result: ScannedModule[] = [];

    for (const module of modules) {
      const mid = module.moduleId;
      const count = seen.get(mid) ?? 0;
      seen.set(mid, count + 1);

      if (count > 0) {
        const newId = `${mid}_${count + 1}`;
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
}
