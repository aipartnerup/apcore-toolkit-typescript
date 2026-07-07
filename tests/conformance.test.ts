import { describe, it, expect, vi } from 'vitest';
import { Registry, FunctionModule, createAnnotations } from 'apcore-js';
import { createScannedModule } from '../src/types.js';

vi.mock('../src/resolve-target.js', () => ({
  resolveTarget: vi.fn().mockResolvedValue((_inputs: Record<string, unknown>) => ({ result: 'ok' })),
}));

import { RegistryWriter } from '../src/output/registry-writer.js';
import { assertAnnotationsPreserved } from '../src/conformance.js';

const BASE = {
  moduleId: 'orders.delete_order',
  description: 'Delete an order',
  inputSchema: { type: 'object', properties: { orderId: { type: 'integer' } } },
  outputSchema: { type: 'object' },
  tags: [],
  target: 'some-module:handler',
} as const;

describe('assertAnnotationsPreserved', () => {
  it('passes for the base RegistryWriter (annotations survive round-trip)', async () => {
    const mod = createScannedModule({
      ...BASE,
      annotations: createAnnotations({ destructive: true, requiresApproval: true }),
    });
    await expect(assertAnnotationsPreserved(new RegistryWriter(), mod, new Registry())).resolves.toBeUndefined();
  });

  it('throws for a writer that drops annotations (historical adapter bug)', async () => {
    const droppingWriter = {
      async write(mods: ReturnType<typeof createScannedModule>[], registry: Registry) {
        for (const m of mods) {
          registry.register(
            m.moduleId,
            new FunctionModule({ moduleId: m.moduleId, description: m.description, execute: async () => ({}) }),
          );
        }
        return [];
      },
    };
    const mod = createScannedModule({ ...BASE, annotations: createAnnotations({ requiresApproval: true }) });
    await expect(assertAnnotationsPreserved(droppingWriter, mod, new Registry())).rejects.toThrow(
      /requiresApproval|lost its annotations/,
    );
  });

  it('requires annotations to be set on the input module', async () => {
    const mod = createScannedModule({ ...BASE });
    await expect(assertAnnotationsPreserved(new RegistryWriter(), mod, new Registry())).rejects.toThrow(
      /annotations to be set/,
    );
  });
});
