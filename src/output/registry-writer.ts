import { FunctionModule, jsonSchemaToTypeBox } from 'apcore-js';
import type { Context, ModuleExample } from 'apcore-js';
import { resolveTarget } from '../resolve-target.js';
import type { ScannedModule } from '../types.js';
import type { WriteResult, Verifier } from './types.js';
import { createWriteResult } from './types.js';
import { RegistryVerifier, runVerifierChain } from './verifiers.js';

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
    options?: { dryRun?: boolean; verify?: boolean; verifiers?: Verifier[] },
  ): Promise<WriteResult[]> {
    const shouldVerify = options?.verify ?? false;
    const verifiers = options?.verifiers ?? [];
    const results: WriteResult[] = [];

    for (const mod of modules) {
      if (options?.dryRun) {
        results.push(createWriteResult(mod.moduleId, null));
        continue;
      }
      const fm = await this._toFunctionModule(mod);
      registry.register(mod.moduleId, fm);

      let result = createWriteResult(mod.moduleId, null);
      if (shouldVerify) {
        const builtinResult = new RegistryVerifier(registry).verify('', mod.moduleId);
        if (!builtinResult.ok) {
          result = createWriteResult(mod.moduleId, null, false, builtinResult.error ?? null);
        }
      }
      if (result.verified && verifiers.length > 0) {
        const vResult = runVerifierChain(verifiers, '', mod.moduleId);
        if (!vResult.ok) {
          result = createWriteResult(mod.moduleId, null, false, vResult.error ?? null);
        }
      }
      results.push(result);
    }
    return results;
  }

  private async _toFunctionModule(mod: ScannedModule): Promise<FunctionModule> {
    const targetFn = (await resolveTarget(mod.target)) as (
      inputs: Record<string, unknown>,
    ) => unknown;

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
      tags: mod.tags.length > 0 ? [...mod.tags] : null,
      version: mod.version,
      // FunctionModule.annotations stores its input as-is, so we must pass the
      // camelCase runtime ModuleAnnotations (not the snake_case wire form
      // emitted by annotationsToDict, which is for YAML/serializer output).
      annotations: mod.annotations,
      metadata: Object.keys(mod.metadata).length > 0 ? { ...mod.metadata } : null,
      examples: mod.examples.length > 0 ? ([...mod.examples] as ModuleExample[]) : null,
      // NOTE: ScannedModule carries a `display` field (populated by DisplayResolver).
      // FunctionModule in apcore-js does not currently expose a display slot, so
      // the display metadata is intentionally omitted here. In Rust, ModuleDescriptor
      // includes a display field — once apcore-js exposes one, wire it here.
    });
  }
}
