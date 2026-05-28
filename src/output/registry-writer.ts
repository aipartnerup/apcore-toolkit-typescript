import { FunctionModule, jsonSchemaToTypeBox } from 'apcore-js';
import type { Context, ModuleExample } from 'apcore-js';

// The apcore streaming marker — defined locally so the toolkit works correctly
// even when the installed apcore-js version doesn't yet re-export the constant.
// Symbol.for guarantees the same key across all modules in the runtime.
const STREAMING_MARKER = Symbol.for('apcore.streaming');
import { resolveTarget } from '../resolve-target.js';
import type { ScannedModule } from '../types.js';
import type { WriteResult } from './types.js';
import { createWriteResult } from './types.js';
import { RegistryVerifier } from './verifiers.js';
import { WriteError } from './errors.js';
import { applyVerification } from './base-writer.js';
import type { FileWriteOptions } from './base-writer.js';

/**
 * FunctionModule subclass that additionally implements the StreamingModule interface.
 *
 * Adds `[STREAMING_MARKER]: true` and a `stream()` method so that
 * `isStreamingModule()` returns true and `Registry.register()` accepts modules
 * whose `annotations.streaming === true`.  The `stream()` implementation
 * delegates to the provided `streamFn`, which is typically the `stream()`
 * method of the resolved target.
 */
class StreamingFunctionModule extends FunctionModule {
  private readonly _streamFn: (
    inputs: Record<string, unknown>,
    context: Context,
  ) => AsyncGenerator<Record<string, unknown>>;

  constructor(
    options: ConstructorParameters<typeof FunctionModule>[0],
    streamFn: (inputs: Record<string, unknown>, context: Context) => AsyncGenerator<Record<string, unknown>>,
  ) {
    super(options);
    this._streamFn = streamFn;
    // Use Object.defineProperty rather than a class field or getter so the
    // symbol-keyed property is reliably present regardless of how esbuild,
    // tsc, or Vitest transforms computed symbol properties.
    Object.defineProperty(this, STREAMING_MARKER, {
      value: true as const,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  stream(inputs: Record<string, unknown>, context: Context): AsyncGenerator<Record<string, unknown>> {
    return this._streamFn(inputs, context);
  }
}

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
    const streamingRequested = mod.annotations?.streaming === true;

    if (streamingRequested) {
      const resolvedObj = resolved as Record<string, unknown>;
      const streamMethod = resolvedObj['stream'];

      if (typeof streamMethod === 'function') {
        // Target exposes a stream() method — build StreamingFunctionModule.
        // For the execute path prefer the target's execute() when present;
        // fall back to treating the resolved value as a plain function.
        let execFn: (inputs: Record<string, unknown>, context: Context) => Promise<Record<string, unknown>>;
        const executeMethod = resolvedObj['execute'];
        if (typeof executeMethod === 'function') {
          execFn = async (inputs, context) => {
            const result = await (executeMethod as (
              inputs: Record<string, unknown>,
              context: Context,
            ) => Promise<unknown>).call(resolved, inputs, context);
            if (result == null) return {};
            if (typeof result !== 'object' || Array.isArray(result)) return { result };
            return result as Record<string, unknown>;
          };
        } else if (typeof resolved === 'function') {
          const targetFn = resolved as (inputs: Record<string, unknown>) => unknown;
          execFn = async (inputs) => {
            const result = await targetFn(inputs);
            if (result == null) return {};
            if (typeof result !== 'object' || Array.isArray(result)) return { result };
            return result as Record<string, unknown>;
          };
        } else {
          // Object has stream() but neither execute() nor a callable form.
          // Use an echo execute so schema-only streaming registration works
          // (mirrors Rust's passthrough handler).
          execFn = async (inputs) => inputs as Record<string, unknown>;
        }

        const streamFn = (inputs: Record<string, unknown>, context: Context) =>
          (streamMethod as (
            inputs: Record<string, unknown>,
            context: Context,
          ) => AsyncGenerator<Record<string, unknown>>).call(resolved, inputs, context);

        return new StreamingFunctionModule(
          {
            execute: execFn,
            moduleId: mod.moduleId,
            inputSchema: jsonSchemaToTypeBox(mod.inputSchema),
            outputSchema: jsonSchemaToTypeBox(mod.outputSchema),
            description: mod.description,
            documentation: mod.documentation,
            tags: [...mod.tags],
            version: mod.version,
            annotations: mod.annotations,
            metadata: { ...mod.metadata },
            examples: [...mod.examples] as ModuleExample[],
          },
          streamFn,
        );
      }

      // Streaming declared but no stream() method on the resolved target.
      console.warn(
        `[apcore-toolkit:registry-writer] Module '${mod.moduleId}' has annotations.streaming=true ` +
          `but target '${mod.target}' exposes no stream() method; clearing streaming flag to avoid ` +
          `StreamingInterfaceError at registration. ` +
          `Implement stream(inputs, context) on the target or register the module directly via Registry.register().`,
      );
      // Clear the streaming flag so Registry.register() does not reject the module.
      const annotations = mod.annotations ? { ...mod.annotations, streaming: false } : null;

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
        annotations,
        metadata: { ...mod.metadata },
        examples: [...mod.examples] as ModuleExample[],
      });
    }

    // Non-streaming path: existing behavior.
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
      annotations: mod.annotations,
      metadata: { ...mod.metadata },
      examples: [...mod.examples] as ModuleExample[],
    });
  }
}
