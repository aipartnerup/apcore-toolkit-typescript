import { writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import type { ScannedModule } from '../types.js';
import type { WriteResult } from './types.js';
import { createWriteResult } from './types.js';
import { WriteError } from './errors.js';
import { SyntaxVerifier } from './verifiers.js';
import { applyVerification } from './base-writer.js';
import type { FileWriteOptions } from './base-writer.js';

/**
 * Write scanned modules as TypeScript source files.
 *
 * Each module is emitted as a `<module_id>.ts` file that re-exports the
 * target function with the apcore binding decorator applied.
 *
 * Language-parity note: this writer is TypeScript-only. Python uses
 * `PythonWriter`; Rust does not have an equivalent code-generation writer.
 * Output from this writer should not be compared to `YAMLWriter` output —
 * they serve different purposes (runtime type-safety vs cross-SDK interchange).
 */
export class TypeScriptWriter {
  write(
    modules: ScannedModule[],
    outputDir: string,
    options?: FileWriteOptions,
  ): WriteResult[] {
    const dryRun = options?.dryRun ?? false;
    const shouldVerify = options?.verify ?? false;
    const verifiers = options?.verifiers ?? [];
    const errorMode = options?.errorMode ?? 'throw';
    const results: WriteResult[] = [];
    const timestamp = new Date().toISOString();

    const resolvedOut = dryRun ? '' : resolve(outputDir);

    if (!dryRun) {
      mkdirSync(resolvedOut, { recursive: true });
    }

    // Dereference symlinks on the output directory itself.
    let realResolvedOut = resolvedOut;
    if (!dryRun) {
      try { realResolvedOut = realpathSync(resolvedOut); } catch { /* keep logical path */ }
    }

    for (const mod of modules) {
      const code = this._generateCode(mod, timestamp);

      if (dryRun) {
        results.push(createWriteResult(mod.moduleId, null));
        continue;
      }

      // Path traversal protection: check raw moduleId before sanitization
      const rawResolved = resolve(join(realResolvedOut, mod.moduleId));
      if (!rawResolved.startsWith(realResolvedOut + sep) && rawResolved !== realResolvedOut) {
        console.warn('Skipping module with path traversal in id: %s', mod.moduleId);
        continue;
      }

      const sanitized = this._sanitizeIdentifier(mod.moduleId);
      const filename = `${sanitized}.ts`;
      const filePath = resolve(join(realResolvedOut, filename));

      // Also block writes when the target file is a symlink escaping the output dir.
      let realFilePath = filePath;
      if (existsSync(filePath)) {
        try { realFilePath = realpathSync(filePath); } catch { /* keep logical path */ }
      }
      if (!realFilePath.startsWith(realResolvedOut + sep) && realFilePath !== realResolvedOut) {
        console.warn('Skipping file outside output directory (symlink escape): %s', filePath);
        continue;
      }

      try {
        writeFileSync(filePath, code, 'utf-8');
      } catch (err) {
        if (errorMode === 'collect') {
          results.push(createWriteResult(mod.moduleId, filePath, false, (err as Error).message));
          continue;
        }
        throw new WriteError(filePath, err as Error);
      }

      const result = applyVerification(
        createWriteResult(mod.moduleId, filePath),
        new SyntaxVerifier(),
        verifiers,
        filePath,
        mod.moduleId,
        shouldVerify,
      );
      results.push(result);
    }

    return results;
  }

  private _generateCode(mod: ScannedModule, timestamp: string): string {
    const { modulePath, exportName } = this._parseTarget(mod.target);

    const lines: string[] = [];
    lines.push(`// Auto-generated apcore module: ${JSON.stringify(mod.moduleId)}`);
    lines.push(`// Generated: ${timestamp}`);
    lines.push('// Do not edit manually unless you intend to customize behavior.');
    lines.push('');
    lines.push("import { module } from 'apcore-js';");
    lines.push("import { Type } from '@sinclair/typebox';");
    lines.push('');
    lines.push('export default module({');
    lines.push(`  id: ${JSON.stringify(mod.moduleId)},`);
    lines.push(`  description: ${JSON.stringify(mod.description)},`);
    lines.push(`  inputSchema: Type.Unsafe(${JSON.stringify(mod.inputSchema)}),`);
    lines.push(`  outputSchema: Type.Unsafe(${JSON.stringify(mod.outputSchema)}),`);
    lines.push(`  tags: ${JSON.stringify([...mod.tags])},`);
    lines.push(`  version: ${JSON.stringify(mod.version)},`);

    if (mod.annotations !== null) {
      lines.push(`  annotations: ${JSON.stringify(mod.annotations)},`);
    }

    lines.push('  async execute(inputs) {');
    lines.push(`    const { ${exportName}: _original } = await import(${JSON.stringify(modulePath)});`);
    lines.push('    return _original(inputs);');
    lines.push('  },');
    lines.push('});');
    lines.push('');

    return lines.join('\n');
  }

  private _parseTarget(target: string): { modulePath: string; exportName: string } {
    const lastColon = target.lastIndexOf(':');
    if (lastColon === -1) {
      throw new Error(`Invalid target format: ${target}`);
    }
    const exportName = target.slice(lastColon + 1);
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(exportName)) {
      throw new Error(`Invalid export name: ${exportName}`);
    }
    return {
      modulePath: target.slice(0, lastColon),
      exportName,
    };
  }

  private _sanitizeIdentifier(name: string): string {
    let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[0-9]/.test(sanitized)) {
      sanitized = `_${sanitized}`;
    }
    return sanitized;
  }
}
