import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnnotations } from 'apcore-js';
import { createScannedModule } from '../src/types.js';
import type { ScannedModule } from '../src/types.js';

vi.mock('../src/resolve-target.js', () => ({
  resolveTarget: vi.fn().mockResolvedValue((inputs: Record<string, unknown>) => ({ result: 'ok' })),
}));

import { RegistryWriter } from '../src/output/registry-writer.js';

const REQUIRED_FIELDS = {
  moduleId: 'test.greet',
  description: 'Greet a user',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { greeting: { type: 'string' } } },
  tags: ['test'],
  target: 'some-module:greet',
} as const;

describe('RegistryWriter', () => {
  let writer: RegistryWriter;
  let mockRegistry: { register: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    writer = new RegistryWriter();
    mockRegistry = { register: vi.fn() };
  });

  describe('dry run', () => {
    it('returns WriteResult without calling registry.register', async () => {
      const mod = createScannedModule({ ...REQUIRED_FIELDS });
      const result = await writer.write([mod], mockRegistry, { dryRun: true });

      expect(result).toHaveLength(1);
      expect(result[0].moduleId).toBe('test.greet');
      expect(result[0].path).toBeNull();
      expect(result[0].verified).toBe(true);
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });

    it('returns multiple WriteResults on dry run', async () => {
      const mod1 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.one' });
      const mod2 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.two' });

      const result = await writer.write([mod1, mod2], mockRegistry, { dryRun: true });

      expect(result).toHaveLength(2);
      expect(result[0].moduleId).toBe('mod.one');
      expect(result[1].moduleId).toBe('mod.two');
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });
  });

  describe('register modules', () => {
    it('registers a single module and returns WriteResult', async () => {
      const mod = createScannedModule({ ...REQUIRED_FIELDS });
      const result = await writer.write([mod], mockRegistry);

      expect(result).toHaveLength(1);
      expect(result[0].moduleId).toBe('test.greet');
      expect(result[0].path).toBeNull();
      expect(result[0].verified).toBe(true);
      expect(mockRegistry.register).toHaveBeenCalledOnce();
      expect(mockRegistry.register).toHaveBeenCalledWith('test.greet', expect.anything());
    });

    it('registers multiple modules into the registry', async () => {
      const mod1 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.one' });
      const mod2 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.two' });
      const mod3 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.three' });

      const result = await writer.write([mod1, mod2, mod3], mockRegistry);

      expect(result).toHaveLength(3);
      expect(result.map(r => r.moduleId)).toEqual(['mod.one', 'mod.two', 'mod.three']);
      expect(mockRegistry.register).toHaveBeenCalledTimes(3);
    });
  });

  describe('empty modules', () => {
    it('returns empty array for empty input', async () => {
      const result = await writer.write([], mockRegistry);

      expect(result).toEqual([]);
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });

    it('returns empty array for empty input with dry run', async () => {
      const result = await writer.write([], mockRegistry, { dryRun: true });

      expect(result).toEqual([]);
    });
  });

  describe('registry.register receives correct arguments', () => {
    it('is called with moduleId and a FunctionModule instance', async () => {
      const mod = createScannedModule({
        ...REQUIRED_FIELDS,
        moduleId: 'test.hello',
        description: 'Say hello',
        version: '2.0.0',
        tags: ['greeting', 'test'],
        documentation: 'Says hello to people',
        annotations: createAnnotations({ readonly: true }),
        metadata: { author: 'tester' },
        examples: [{ name: 'basic', input: { name: 'World' }, output: { greeting: 'Hello, World!' } }],
      });

      await writer.write([mod], mockRegistry);

      expect(mockRegistry.register).toHaveBeenCalledOnce();
      const [registeredId, registeredModule] = mockRegistry.register.mock.calls[0];
      expect(registeredId).toBe('test.hello');
      expect(registeredModule).toBeDefined();
      expect(registeredModule.moduleId).toBe('test.hello');
      expect(registeredModule.description).toBe('Say hello');
      expect(registeredModule.version).toBe('2.0.0');
      expect(registeredModule.documentation).toBe('Says hello to people');
      expect(registeredModule.tags).toEqual(['greeting', 'test']);
      // FunctionModule.annotations stores its input as-is. RegistryWriter
      // must therefore pass the camelCase runtime ModuleAnnotations so that
      // downstream camelCase property access (e.g. fm.annotations.requiresApproval)
      // works. The wire-format snake_case dict is reserved for YAML output.
      expect(registeredModule.annotations).toMatchObject({
        readonly: true,
        requiresApproval: false,
        cacheTtl: 0,
        paginationStyle: 'cursor',
      });
      expect(registeredModule.annotations).not.toHaveProperty('requires_approval');
      expect(registeredModule.annotations).not.toHaveProperty('cache_ttl');
      expect(registeredModule.metadata).toEqual({ author: 'tester' });
      expect(registeredModule.examples).toEqual([
        { name: 'basic', input: { name: 'World' }, output: { greeting: 'Hello, World!' } },
      ]);
    });
  });

  // registry.register() failure handling — D11-8 audit-fix:
  // RegistryWriter.write canonicalised on always-collect (matches Python and
  // Rust + spec D10-006 "one bad module does not abort the batch"). Per-module
  // failures are captured into a failed WriteResult, never thrown.
  describe('registry.register() error handling', () => {
    it('captures registry.register failures into a failed WriteResult', async () => {
      const writer = new RegistryWriter();
      const modA = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.a' });
      const modB = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod.b' });
      const registry = {
        register(id: string, _module: unknown) {
          if (id === 'mod.a') throw new Error('duplicate module id');
        },
      };

      const results = await writer.write([modA, modB], registry);
      expect(results).toHaveLength(2);
      expect(results[0].verified).toBe(false);
      expect(results[0].verificationError).toContain('duplicate module id');
      // The failing module does NOT abort the batch — modB still succeeds.
      expect(results[1].verified).toBe(true);
    });
  });
});

// resolveTarget is already vi.mock'd at the top of the file.
import { resolveTarget } from '../src/resolve-target.js';
const mockResolveTarget = vi.mocked(resolveTarget);

describe('streaming module detection (apcore 0.22.0)', () => {

  it('wraps target with stream() as StreamingFunctionModule with STREAMING_MARKER', async () => {
    const chunks: Record<string, unknown>[] = [{ chunk: 1 }, { chunk: 2 }];
    async function* fakeStream(_inputs: Record<string, unknown>, _ctx: unknown) {
      for (const c of chunks) yield c;
    }
    const streamingTarget = {
      stream: fakeStream,
    };
    mockResolveTarget.mockResolvedValueOnce(streamingTarget as unknown as ((...args: unknown[]) => unknown));

    const STREAMING_MARKER_SYM = Symbol.for('apcore.streaming');
    const writer = new RegistryWriter();
    const mod = createScannedModule({
      ...REQUIRED_FIELDS,
      moduleId: 'stream.test',
      annotations: createAnnotations({ streaming: true }),
    });
    const registry = { register: vi.fn() };
    const results = await writer.write([mod], registry);

    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(true);
    const registered = registry.register.mock.calls[0][1] as Record<symbol, unknown>;
    expect(registered[STREAMING_MARKER_SYM]).toBe(true);
    expect(typeof (registered as Record<string, unknown>)['stream']).toBe('function');
  });

  it('clears streaming flag and warns when target has no stream()', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plainFn = (_inputs: Record<string, unknown>) => ({ result: 'ok' });
    mockResolveTarget.mockResolvedValueOnce(plainFn as unknown as ((...args: unknown[]) => unknown));

    const writer = new RegistryWriter();
    const mod = createScannedModule({
      ...REQUIRED_FIELDS,
      moduleId: 'stream.no_impl',
      annotations: createAnnotations({ streaming: true }),
    });
    const registry = { register: vi.fn() };
    const results = await writer.write([mod], registry);

    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(true);
    const registered = registry.register.mock.calls[0][1] as Record<string, unknown>;
    const ann = registered['annotations'] as Record<string, unknown> | null;
    expect(ann?.['streaming']).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('streaming'));
    warnSpy.mockRestore();
  });

  it('clears streaming flag and warns when stream() is a plain synchronous function (not an async generator)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A synchronous function named `stream` should NOT be mistaken for an
    // async-generator streaming implementation — `typeof fn === 'function'`
    // is true for both, but only `async function* () {}` actually produces
    // an AsyncGenerator when called. Wrapping this as StreamingFunctionModule
    // would fail later at call time (async-iterating a plain return value)
    // instead of being caught here at registration time.
    const syncStream = (_inputs: Record<string, unknown>) => ({ chunk: 1 });
    const targetFn = (_inputs: Record<string, unknown>) => ({ result: 'ok' });
    (targetFn as unknown as { stream: typeof syncStream }).stream = syncStream;
    mockResolveTarget.mockResolvedValueOnce(targetFn as unknown as ((...args: unknown[]) => unknown));

    const STREAMING_MARKER_SYM = Symbol.for('apcore.streaming');
    const writer = new RegistryWriter();
    const mod = createScannedModule({
      ...REQUIRED_FIELDS,
      moduleId: 'stream.sync_impl',
      annotations: createAnnotations({ streaming: true }),
    });
    const registry = { register: vi.fn() };
    const results = await writer.write([mod], registry);

    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(true);
    const registered = registry.register.mock.calls[0][1] as Record<string | symbol, unknown>;
    expect(registered[STREAMING_MARKER_SYM]).toBeUndefined();
    expect(typeof (registered as Record<string, unknown>)['stream']).not.toBe('function');
    const ann = registered['annotations'] as Record<string, unknown> | null;
    expect(ann?.['streaming']).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('streaming'));
    warnSpy.mockRestore();
  });
});
