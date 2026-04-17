import type { ModuleAnnotations, ModuleExample } from 'apcore-js';

export interface ScannedModule {
  readonly moduleId: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly tags: readonly string[];
  readonly target: string;
  readonly version: string;
  readonly annotations: ModuleAnnotations | null;
  readonly documentation: string | null;
  /**
   * Scanner-generated human-friendly alias used by surface adapters in the
   * resolve chain before falling back to moduleId. Scanners SHOULD set this
   * using `BaseScanner.generateSuggestedAlias()` when the source endpoint
   * has HTTP route information. Defaults to null.
   */
  readonly suggestedAlias: string | null;
  readonly examples: readonly ModuleExample[];
  readonly metadata: Record<string, unknown>;
  readonly warnings: readonly string[];
}

export function createScannedModule(options: {
  moduleId: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  tags: string[];
  target: string;
  version?: string;
  annotations?: ModuleAnnotations | null;
  documentation?: string | null;
  suggestedAlias?: string | null;
  examples?: ModuleExample[];
  metadata?: Record<string, unknown>;
  warnings?: string[];
}): ScannedModule {
  return {
    moduleId: options.moduleId,
    description: options.description,
    inputSchema: { ...options.inputSchema },
    outputSchema: { ...options.outputSchema },
    tags: [...options.tags],
    target: options.target,
    version: options.version ?? '1.0.0',
    annotations: options.annotations ?? null,
    documentation: options.documentation ?? null,
    suggestedAlias: options.suggestedAlias ?? null,
    examples: [...(options.examples ?? [])],
    metadata: { ...(options.metadata ?? {}) },
    warnings: [...(options.warnings ?? [])],
  };
}

export function cloneModule(
  module: ScannedModule,
  overrides?: Partial<ScannedModule>,
): ScannedModule {
  const merged = { ...module, ...overrides };
  return {
    ...merged,
    tags: [...merged.tags],
    examples: [...merged.examples],
    metadata: { ...merged.metadata },
    warnings: [...merged.warnings],
    inputSchema: { ...merged.inputSchema },
    outputSchema: { ...merged.outputSchema },
  };
}
