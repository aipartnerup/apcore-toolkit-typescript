import { writeFileSync, mkdirSync, realpathSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
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
    const writtenIds = new Map<string, string>(); // filename → moduleId that claimed it

    const resolvedOut = dryRun ? '' : resolve(outputDir);

    if (!dryRun) {
      try {
        mkdirSync(resolvedOut, { recursive: true });
      } catch (err) {
        throw new WriteError(resolvedOut, err);
      }
    }

    let realResolvedOut = resolvedOut;
    if (!dryRun) {
      try {
        realResolvedOut = realpathSync(resolvedOut);
      } catch (err) {
        throw new WriteError(resolvedOut, err);
      }
    }

    for (const mod of modules) {
      let code: string;
      try {
        code = this._generateCode(mod, timestamp);
      } catch (err) {
        if (errorMode === 'collect') {
          results.push(createWriteResult(mod.moduleId, null, false, err instanceof Error ? err.message : String(err)));
          continue;
        }
        throw new WriteError(mod.moduleId, err);
      }

      if (dryRun) {
        results.push(createWriteResult(mod.moduleId, null));
        continue;
      }

      const sanitized = this._sanitizeIdentifier(mod.moduleId);
      const filename = `${sanitized}.ts`;
      const filePath = resolve(join(realResolvedOut, filename));

      if (writtenIds.has(filename)) {
        console.warn(
          'TypeScriptWriter: safeId collision — "%s" and "%s" both map to %s; overwriting',
          writtenIds.get(filename),
          mod.moduleId,
          filename,
        );
      }
      writtenIds.set(filename, mod.moduleId);

      // Block symlinks pre-created at the target path (TOCTOU mitigation).
      // lstatSync does not follow symlinks, so it detects symlinks directly.
      try {
        if (lstatSync(filePath).isSymbolicLink()) {
          console.warn('Skipping symlink escape at: %s', filePath);
          results.push(createWriteResult(mod.moduleId, filePath, false, 'Security skip: symlink at target path'));
          continue;
        }
      } catch { /* file does not exist — safe to write */ }

      // Atomic write: write to a tmp file then rename so readers never see a
      // partially-written file and so the final rename is atomic on POSIX.
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      try {
        writeFileSync(tmpPath, code, 'utf-8');
        renameSync(tmpPath, filePath);
      } catch (err) {
        try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
        if (errorMode === 'collect') {
          results.push(createWriteResult(mod.moduleId, filePath, false, err instanceof Error ? err.message : String(err)));
          continue;
        }
        throw new WriteError(filePath, err);
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
    if (sanitized.length === 0) {
      sanitized = '_module';
    }
    return sanitized;
  }
}
