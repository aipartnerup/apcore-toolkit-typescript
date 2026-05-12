import { FunctionModule, jsonSchemaToTypeBox } from 'apcore-js';
import type { Context, ModuleExample } from 'apcore-js';
import { resolveTarget } from '../resolve-target.js';
import type { ScannedModule } from '../types.js';
import type { WriteResult } from './types.js';
import { createWriteResult } from './types.js';
import { RegistryVerifier } from './verifiers.js';
import { WriteError } from './errors.js';
import { applyVerification } from './base-writer.js';
import type { FileWriteOptions } from './base-writer.js';

/**
 * Write scanned modules to an apcore-js registry.
 *
 * Resolves each module's target function via `resolveTarget`, wraps it in a
 * `FunctionModule`, and calls `registry.register()`. Supports dry-run and
 * built-in / custom verification.
 */
export class RegistryWriter {
  /**
   * Register modules into the provided registry.
   *
   * @async This method is async in TypeScript due to dynamic module loading via
   *        `resolveTarget`. In Python and Rust the equivalent is synchronous.
   *        Always `await` this call: `await writer.write(modules, registry)`.
   *
   * @param modules - Scanned modules to register.
   * @param registry - Target registry that implements `register()`.
   * @param options - Optional write options: `dryRun`, `verify`, `verifiers`.
   * @returns Array of WriteResult, one per module.
   */
  async write(
    modules: ScannedModule[],
    registry: { register(moduleId: string, module: unknown): void; getModule?(id: string): unknown },
    options?: FileWriteOptions & { allowedPrefixes?: string[] },
  ): Promise<WriteResult[]> {
    const shouldVerify = options?.verify ?? false;
    const verifiers = options?.verifiers ?? [];
    const allowedPrefixes = options?.allowedPrefixes;
    const results: WriteResult[] = [];

    for (const mod of modules) {
      if (options?.dryRun) {
        results.push(createWriteResult(mod.moduleId, null));
        continue;
      }
      // Per-module failures (target resolution, registry.register) are
      // captured into a failed WriteResult rather than thrown so one bad
      // module does not abort the batch. Mirrors Python and Rust and
      // matches the spec contract for HTTPProxyRegistryWriter.write.
      let fm: FunctionModule;
      try {
        fm = await this._toFunctionModule(mod, allowedPrefixes);
      } catch (err) {
        results.push(
          createWriteResult(
            mod.moduleId,
            null,
            false,
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          ),
        );
        continue;
      }
      try {
        registry.register(mod.moduleId, fm);
      } catch (err) {
        results.push(
          createWriteResult(
            mod.moduleId,
            null,
            false,
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          ),
        );
        continue;
      }

      const result = applyVerification(
        createWriteResult(mod.moduleId, null),
        new RegistryVerifier(registry),
        verifiers,
        '',
        mod.moduleId,
        shouldVerify,
      );
      results.push(result);
    }
    return results;
  }

  private async _toFunctionModule(mod: ScannedModule, allowedPrefixes?: string[]): Promise<FunctionModule> {
    const resolved = await resolveTarget(mod.target, allowedPrefixes);
    if (typeof resolved !== 'function') {
      throw new Error(
        `Target "${mod.target}" resolved to ${typeof resolved}, expected a function.`,
      );
    }
    const targetFn = resolved as (inputs: Record<string, unknown>) => unknown;

    return new FunctionModule({
      execute: async (inputs: Record<string, unknown>, _context: Context) => {
        const result = await targetFn(inputs);
        if (result == null) return {};
        if (typeof result !== 'object' || Array.isArray(result)) return { result };
        return result as Record<string, unknown>;
      },
      moduleId: mod.moduleId,
      inputSchema: jsonSchemaToTypeBox(mod.inputSchema),
      outputSchema: jsonSchemaToTypeBox(mod.outputSchema),
      description: mod.description,
      documentation: mod.documentation,
      tags: [...mod.tags],
      version: mod.version,
      // FunctionModule.annotations stores its input as-is, so we must pass the
      // camelCase runtime ModuleAnnotations (not the snake_case wire form
      // emitted by annotationsToDict, which is for YAML/serializer output).
      annotations: mod.annotations,
      metadata: { ...mod.metadata },
      examples: [...mod.examples] as ModuleExample[],
    });
  }
}
