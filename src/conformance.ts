/**
 * Cross-adapter conformance checks for registry writers.
 *
 * Import into an adapter's test suite to assert that registering a scanned
 * module **preserves its behavioral annotations**. Approval and ACL gating key
 * on `requiresApproval` (and read `destructive`); if a writer drops annotations
 * during registration the gate silently never fires — no error, no warning.
 * This helper turns that otherwise-invisible regression into a failing test.
 */

import type { ScannedModule } from './types.js';

/** Governance-relevant flags whose loss silently disables approval/ACL gating. */
export const DEFAULT_CONFORMANCE_FIELDS = ['requiresApproval', 'destructive'] as const;

/** Minimal registry surface the check needs. */
export interface AnnotationCarryingRegistry {
  register(moduleId: string, module: unknown): void | Promise<void>;
  getDefinition(moduleId: string): { annotations?: unknown } | null;
}

/** Minimal writer surface the check needs. */
export interface AnnotationWriter {
  write(modules: ScannedModule[], registry: unknown, options?: unknown): Promise<unknown>;
}

/**
 * Register `scannedModule` via `writer` and assert its behavioral annotations
 * survive `registry.getDefinition`. Throws on a dropped/changed field, so it
 * works from any test runner. Use a **real** `Registry` (not a mock) and a
 * module whose `target` resolves to a real callable and whose `annotations`
 * are set to the values under test.
 *
 * @throws if the module was not registered, lost its annotations, or any
 *   checked field changed value during registration.
 */
export async function assertAnnotationsPreserved(
  writer: AnnotationWriter,
  scannedModule: ScannedModule,
  registry: AnnotationCarryingRegistry,
  fields: readonly string[] = DEFAULT_CONFORMANCE_FIELDS,
): Promise<void> {
  const source = scannedModule.annotations as Record<string, unknown> | null;
  if (source == null) {
    throw new Error(
      'assertAnnotationsPreserved expects scannedModule.annotations to be set ' +
        '(that is what the round-trip is verifying)',
    );
  }

  const moduleId = scannedModule.moduleId;
  await writer.write([scannedModule], registry);
  const definition = registry.getDefinition(moduleId);

  if (definition == null) {
    throw new Error(`conformance: module '${moduleId}' was not registered`);
  }
  if (definition.annotations == null) {
    throw new Error(
      `conformance: module '${moduleId}' lost its annotations during registration — ` +
        'approval/ACL gating that keys on requiresApproval will silently never fire',
    );
  }

  const registered = definition.annotations as Record<string, unknown>;
  for (const field of fields) {
    if (registered[field] !== source[field]) {
      throw new Error(
        `conformance: module '${moduleId}' annotation '${field}' changed during ` +
          `registration — expected ${String(source[field])}, got ${String(registered[field])}`,
      );
    }
  }
}
