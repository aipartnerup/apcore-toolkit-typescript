/**
 * BindingLoader — parse `.binding.yaml` files back into `ScannedModule`.
 *
 * Inverse of {@link YAMLWriter}. Unlike apcore-js's binding loader (which
 * imports the target and creates a runtime `FunctionModule`), this loader
 * is pure data: it parses YAML into `ScannedModule` objects for validation,
 * merging, diffing, or round-trip workflows. No module resolution occurs.
 *
 * This file adds the filesystem-reading entry point (`load(filePath)`) on
 * top of the runtime-neutral parsing in `binding-parser.ts`. Consumers that
 * only need to parse already-loaded documents (browsers, edge runtimes,
 * workers) should use {@link BindingParser} or {@link parseBindingDocument}
 * from `apcore-toolkit/browser` instead.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  BindingLoadError,
  BindingParser,
  parseBindingDocument,
} from './binding-parser.js';
import type { BindingLoadOptions } from './binding-parser.js';
import type { ScannedModule } from './types.js';

// Re-export the runtime-neutral surface so the default package entry
// (`apcore-toolkit`) continues to expose exactly the same symbols it did
// before the split — existing consumers (`nestjs-apcore` etc.) see no
// change — plus the new {@link BindingParser} and
// {@link parseBindingDocument} additions that are now also available.
export { BindingLoadError, BindingParser, parseBindingDocument } from './binding-parser.js';
export type { BindingLoadOptions } from './binding-parser.js';

/** Maximum file size (bytes) that BindingLoader will read — matches Rust SDK's 16 MiB cap. */
const MAX_BINDING_FILE_SIZE = 16 * 1024 * 1024; // 16 MiB

/** Maximum number of .binding.yaml files per directory scan — matches Rust SDK's cap. */
const MAX_BINDING_FILES_PER_DIR = 10_000;

// Cap on directory recursion depth in `_collectRecursive`. This is the
// PRIMARY defense against symlink loops (`a -> b -> a`): `statSync` resolves
// symlinks but does not detect cycles, so a cyclic graph would recurse until
// the JS stack overflows without this cap. Also bounds worst-case stack
// usage on legitimately-deep trees; 64 is well above any realistic
// `.binding.yaml` layout.
const MAX_RECURSION_DEPTH = 64;

/**
 * Loads `.binding.yaml` files into `ScannedModule` objects.
 *
 * Extends {@link BindingParser} so `loadData(data)` (runtime-neutral parsing
 * of pre-loaded documents) is also available on every `BindingLoader`
 * instance — the class hierarchy mirrors the Python SDK's
 * `BindingLoader.load_data` method.
 *
 * @example
 * ```ts
 * const loader = new BindingLoader();
 * const modules = loader.load('./bindings/');
 * const strict = loader.load('foo.binding.yaml', true, false);
 * ```
 */
export class BindingLoader extends BindingParser {
  /**
   * Load one file or every `*.binding.yaml` in a directory.
   *
   * @param filePath - Path to a single `.binding.yaml` file or a directory.
   * @param strict - When `true`, also require `input_schema` and `output_schema`. Default: `false`.
   * @param recursive - When `true`, recurse into subdirectories. Default: `false`.
   * @throws {BindingLoadError} when the path is missing, YAML is malformed,
   *   or any entry fails validation.
   */
  load(filePath: string, strict?: boolean, recursive?: boolean): ScannedModule[] {
    strict = strict ?? false;
    recursive = recursive ?? false;

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
      // Enforce the per-directory file-count cap on the merged list so the
      // recursive branch is bounded too. Rust and Python apply the cap
      // unconditionally; the previous TypeScript implementation only
      // checked the non-recursive branch (A-D-013).
      if (files.length > MAX_BINDING_FILES_PER_DIR) {
        throw new BindingLoadError({
          reason: `too many files in directory: ${files.length} exceeds limit of ${MAX_BINDING_FILES_PER_DIR}`,
          filePath,
        });
      }
    } else {
      throw new BindingLoadError({
        reason: 'path is neither a file nor a directory',
        filePath,
      });
    }

    const modules: ScannedModule[] = [];
    for (const f of files) {
      // Enforce per-file size cap before reading
      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(f);
      } catch (exc) {
        throw new BindingLoadError({
          reason: `failed to stat file: ${(exc as Error).message}`,
          filePath: f,
        });
      }
      if (fileStat.size > MAX_BINDING_FILE_SIZE) {
        throw new BindingLoadError({
          reason: `file too large: ${fileStat.size} bytes exceeds limit of ${MAX_BINDING_FILE_SIZE} bytes (16 MiB)`,
          filePath: f,
        });
      }
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
      modules.push(...parseBindingDocument(raw, { strict }, f));
    }
    return modules;
  }

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
}
