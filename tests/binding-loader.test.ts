import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { createAnnotations } from 'apcore-js';
import { BindingLoader, BindingLoadError } from '../src/binding-loader.js';
import { YAMLWriter } from '../src/output/yaml-writer.js';
import { createScannedModule } from '../src/types.js';

const MINIMAL_ENTRY = { module_id: 'x.y', target: 'pkg:func' };

const FULL_ENTRY = {
  module_id: 'users.get_user',
  target: 'myapp.views:get_user',
  description: 'Get a user',
  documentation: 'Returns a user by ID.',
  tags: ['users', 'get'],
  version: '2.0.0',
  annotations: { readonly: true, cacheable: true, cache_ttl: 60 },
  examples: [{ title: 'happy', inputs: { id: 1 }, output: { name: 'alice' } }],
  metadata: { http_method: 'GET' },
  input_schema: { type: 'object', properties: { id: { type: 'integer' } } },
  output_schema: { type: 'object' },
  display: { mcp: { alias: 'users_get' }, alias: 'users.get' },
  suggested_alias: 'users.get.alt',
  warnings: ['stale'],
};

describe('BindingLoader.loadData', () => {
  let loader: BindingLoader;

  beforeEach(() => {
    loader = new BindingLoader();
  });

  it('parses a minimal loose entry with defaults', () => {
    const modules = loader.loadData({ bindings: [MINIMAL_ENTRY] });
    expect(modules).toHaveLength(1);
    const m = modules[0];
    expect(m.moduleId).toBe('x.y');
    expect(m.target).toBe('pkg:func');
    expect(m.description).toBe('');
    expect(m.inputSchema).toEqual({});
    expect(m.outputSchema).toEqual({});
    expect(m.tags).toEqual([]);
    expect(m.version).toBe('1.0.0');
    expect(m.annotations).toBeNull();
    expect(m.display).toBeNull();
  });

  it('strict mode requires input_schema and output_schema', () => {
    expect(() => loader.loadData({ bindings: [MINIMAL_ENTRY] }, { strict: true })).toThrow(
      BindingLoadError,
    );
    try {
      loader.loadData({ bindings: [MINIMAL_ENTRY] }, { strict: true });
    } catch (exc) {
      const err = exc as BindingLoadError;
      expect(err.missingFields).toContain('input_schema');
      expect(err.missingFields).toContain('output_schema');
      expect(err.moduleId).toBe('x.y');
    }
  });

  it('strict mode accepts when schemas present', () => {
    const entry = {
      module_id: 'x.y',
      target: 'p:f',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
    };
    const modules = loader.loadData({ bindings: [entry] }, { strict: true });
    expect(modules).toHaveLength(1);
  });

  it('always fails on missing module_id', () => {
    expect(() => loader.loadData({ bindings: [{ target: 'p:f' }] })).toThrow(BindingLoadError);
  });

  it('always fails on missing target', () => {
    expect(() => loader.loadData({ bindings: [{ module_id: 'x' }] })).toThrow(BindingLoadError);
  });

  it('fails when bindings key missing', () => {
    expect(() => loader.loadData({ spec_version: '1.0' })).toThrow(/bindings/);
  });

  it('fails when top-level is not a mapping', () => {
    expect(() => loader.loadData(['a', 'b'] as unknown as Record<string, unknown>)).toThrow(
      BindingLoadError,
    );
  });

  it('fails when an entry is not a mapping', () => {
    expect(() => loader.loadData({ bindings: ['scalar' as unknown as Record<string, unknown>] })).toThrow(
      /mapping/,
    );
  });

  it('parses full annotations via annotationsFromJSON', () => {
    const m = loader.loadData({ bindings: [FULL_ENTRY] })[0];
    expect(m.annotations).not.toBeNull();
    expect(m.annotations?.readonly).toBe(true);
    expect(m.annotations?.cacheable).toBe(true);
    expect(m.annotations?.cacheTtl).toBe(60);
  });

  it('treats non-dict annotations as null with a warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const m = loader.loadData({
        bindings: [{ module_id: 'x', target: 'p:f', annotations: 'readonly' }],
      })[0];
      expect(m.annotations).toBeNull();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves display overlay', () => {
    const m = loader.loadData({ bindings: [FULL_ENTRY] })[0];
    expect(m.display).toEqual({ mcp: { alias: 'users_get' }, alias: 'users.get' });
  });

  it('defaults display to null when absent', () => {
    const m = loader.loadData({ bindings: [MINIMAL_ENTRY] })[0];
    expect(m.display).toBeNull();
  });

  it('warns and drops malformed display (non-object)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const m = loader.loadData({
        bindings: [{ module_id: 'x', target: 'p:f', display: 'not-a-dict' }],
      })[0];
      expect(m.display).toBeNull();
      expect(
        spy.mock.calls.some((c) => String(c[0]).includes('display') && String(c[0]).includes('x')),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('warns when input_schema is not a mapping', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const m = loader.loadData({
        bindings: [{ module_id: 'x', target: 'p:f', input_schema: 'string' }],
      })[0];
      expect(m.inputSchema).toEqual({});
      expect(
        spy.mock.calls.some((c) => String(c[0]).includes('input_schema')),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('parses examples array', () => {
    const m = loader.loadData({ bindings: [FULL_ENTRY] })[0];
    expect(m.examples).toHaveLength(1);
    expect(m.examples[0].title).toBe('happy');
  });

  it('skips malformed examples entries', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const m = loader.loadData({
        bindings: [
          {
            module_id: 'x',
            target: 'p:f',
            examples: [{ title: 'ok', inputs: {}, output: {} }, 'bad'],
          },
        ],
      })[0];
      expect(m.examples).toHaveLength(1);
      expect(m.examples[0].title).toBe('ok');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('BindingLoader spec_version', () => {
  it('warns when spec_version missing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      new BindingLoader().loadData({ bindings: [MINIMAL_ENTRY] });
      expect(spy.mock.calls.some((c) => String(c[0]).includes('spec_version'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('warns when spec_version is newer than supported', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      new BindingLoader().loadData({ spec_version: '2.0', bindings: [MINIMAL_ENTRY] });
      expect(spy.mock.calls.some((c) => String(c[0]).includes('newer than supported'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('is silent when spec_version is 1.0', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      new BindingLoader().loadData({ spec_version: '1.0', bindings: [MINIMAL_ENTRY] });
      expect(spy.mock.calls.some((c) => String(c[0]).includes('spec_version'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('BindingLoader.load (filesystem)', () => {
  let tmpDir: string;
  let loader: BindingLoader;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'binding-loader-test-'));
    loader = new BindingLoader();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a single file', () => {
    const f = join(tmpDir, 'one.binding.yaml');
    writeFileSync(f, yaml.dump({ spec_version: '1.0', bindings: [FULL_ENTRY] }));
    const modules = loader.load(f);
    expect(modules).toHaveLength(1);
    expect(modules[0].moduleId).toBe('users.get_user');
  });

  it('loads every *.binding.yaml in a directory, sorted', () => {
    ['a', 'b', 'c'].forEach((name, i) => {
      writeFileSync(
        join(tmpDir, `${name}.binding.yaml`),
        yaml.dump({
          spec_version: '1.0',
          bindings: [{ module_id: name, target: `pkg:f${i}` }],
        }),
      );
    });
    writeFileSync(join(tmpDir, 'unrelated.yaml'), 'irrelevant: true');
    const modules = loader.load(tmpDir);
    expect(modules.map((m) => m.moduleId)).toEqual(['a', 'b', 'c']);
  });

  it('throws when path does not exist', () => {
    expect(() => loader.load(join(tmpDir, 'nope'))).toThrow(/does not exist/);
  });

  it('throws on malformed YAML', () => {
    const f = join(tmpDir, 'bad.binding.yaml');
    writeFileSync(f, '::: not yaml :::\n  - [');
    expect(() => loader.load(f)).toThrow(/parse YAML/);
  });

  it('skips empty files', () => {
    const f = join(tmpDir, 'empty.binding.yaml');
    writeFileSync(f, '');
    const modules = loader.load(f);
    expect(modules).toEqual([]);
  });
});

describe('YAMLWriter + BindingLoader round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rt-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves all fields including display and annotations', () => {
    const original = createScannedModule({
      moduleId: 'round.trip',
      description: 'Round-trip test',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      outputSchema: { type: 'object' },
      tags: ['demo'],
      target: 'demo.app:handler',
      version: '1.2.3',
      annotations: createAnnotations({ readonly: true, streaming: true, cacheTtl: 30 }),
      documentation: 'Docs here',
      metadata: { http_method: 'GET' },
      display: { mcp: { alias: 'rt' }, alias: 'round-trip' },
    });

    new YAMLWriter().write([original], tmpDir);
    const loaded = new BindingLoader().load(tmpDir);

    expect(loaded).toHaveLength(1);
    const m = loaded[0];
    expect(m.moduleId).toBe(original.moduleId);
    expect(m.target).toBe(original.target);
    expect(m.description).toBe(original.description);
    expect(m.documentation).toBe(original.documentation);
    expect([...m.tags]).toEqual([...original.tags]);
    expect(m.version).toBe(original.version);
    expect(m.inputSchema).toEqual(original.inputSchema);
    expect(m.outputSchema).toEqual(original.outputSchema);
    expect(m.metadata).toEqual(original.metadata);
    expect(m.display).toEqual(original.display);
    expect(m.annotations?.readonly).toBe(true);
    expect(m.annotations?.streaming).toBe(true);
    expect(m.annotations?.cacheTtl).toBe(30);
  });
});
