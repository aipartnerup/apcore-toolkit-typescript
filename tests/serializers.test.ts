import { describe, it, expect, vi } from 'vitest';
import { createAnnotations } from 'apcore-js';
import { annotationsToDict, moduleToDict, modulesToDicts } from '../src/serializers.js';
import { createScannedModule } from '../src/types.js';

const REQUIRED_FIELDS = {
  moduleId: 'test-module',
  description: 'A test module',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'string' },
  tags: ['test', 'example'],
  target: 'http://localhost:8080/api/test',
} as const;

describe('annotationsToDict', () => {
  it('returns null for null', () => {
    expect(annotationsToDict(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(annotationsToDict(undefined)).toBeNull();
  });

  it('converts camelCase ModuleAnnotations to snake_case wire format', () => {
    const annotations = createAnnotations({
      readonly: true,
      requiresApproval: true,
      cacheTtl: 300,
      paginationStyle: 'offset',
    });
    const result = annotationsToDict(annotations);
    expect(result).toMatchObject({
      readonly: true,
      destructive: false,
      idempotent: false,
      requires_approval: true,
      open_world: true,
      streaming: false,
      cacheable: false,
      cache_ttl: 300,
      cache_key_fields: null,
      paginated: false,
      pagination_style: 'offset',
    });
    // No camelCase keys should leak through.
    expect(result).not.toHaveProperty('requiresApproval');
    expect(result).not.toHaveProperty('cacheTtl');
    expect(result).not.toHaveProperty('paginationStyle');
  });

  it('logs warning and returns null for unrecognized types', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(annotationsToDict('invalid')).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('Unrecognised annotations type');

    warnSpy.mockRestore();
  });

  it('logs warning and returns null for a number', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(annotationsToDict(42)).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it('logs warning and returns null for an array', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(annotationsToDict([1, 2, 3])).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });
});

describe('moduleToDict', () => {
  it('serializes all 12 fields with correct snake_case keys', () => {
    const mod = createScannedModule({
      ...REQUIRED_FIELDS,
      version: '2.0.0',
      annotations: createAnnotations({ readonly: true }),
      documentation: 'Some docs',
      examples: [{ name: 'ex1', input: {}, output: {} }],
      metadata: { author: 'test' },
      warnings: ['warn1'],
    });

    const result = moduleToDict(mod);

    // Top-level fields use snake_case for cross-language wire format parity.
    expect(result.module_id).toBe('test-module');
    expect(result.description).toBe('A test module');
    expect(result.input_schema).toEqual({ type: 'object' });
    expect(result.output_schema).toEqual({ type: 'string' });
    expect(result.tags).toEqual(['test', 'example']);
    expect(result.target).toBe('http://localhost:8080/api/test');
    expect(result.version).toBe('2.0.0');
    expect(result.documentation).toBe('Some docs');
    expect(result.examples).toEqual([{ name: 'ex1', input: {}, output: {} }]);
    expect(result.metadata).toEqual({ author: 'test' });
    expect(result.warnings).toEqual(['warn1']);
    // Annotations are normalized to snake_case wire format via annotationsToJSON.
    expect(result.annotations).toMatchObject({
      readonly: true,
      requires_approval: false,
      cache_ttl: 0,
      pagination_style: 'cursor',
    });
  });

  it('outputs null annotations when module has null annotations', () => {
    const mod = createScannedModule({ ...REQUIRED_FIELDS });
    const result = moduleToDict(mod);

    expect(result.annotations).toBeNull();
  });

  it('outputs empty array for examples when module has no examples', () => {
    const mod = createScannedModule({ ...REQUIRED_FIELDS });
    const result = moduleToDict(mod);

    expect(result.examples).toEqual([]);
  });

  it('has exactly 14 keys including suggested_alias', () => {
    const mod = createScannedModule({ ...REQUIRED_FIELDS });
    const result = moduleToDict(mod);

    expect(Object.keys(result)).toHaveLength(14);
    expect(result).toHaveProperty('suggested_alias');
  });

  it('emits suggestedAlias as suggested_alias (regression for D1-2)', () => {
    const mod = createScannedModule({ ...REQUIRED_FIELDS, suggestedAlias: 'my_fn' });
    const result = moduleToDict(mod);

    expect(result.suggested_alias).toBe('my_fn');
  });

  it('emits null for suggested_alias when unset', () => {
    const mod = createScannedModule({ ...REQUIRED_FIELDS });
    const result = moduleToDict(mod);

    expect(result.suggested_alias).toBeNull();
  });

  it('emits display as null when unset', () => {
    const mod = createScannedModule({ ...REQUIRED_FIELDS });
    const result = moduleToDict(mod);

    expect(result.display).toBeNull();
  });

  it('deep-clones display overlay when set', () => {
    const overlay = { mcp: { alias: 'users_get' } };
    const mod = createScannedModule({ ...REQUIRED_FIELDS, display: overlay });
    const result = moduleToDict(mod);

    expect(result.display).toEqual({ mcp: { alias: 'users_get' } });
    expect(result.display).not.toBe(overlay);
  });
});

describe('modulesToDicts', () => {
  it('converts multiple modules to an array of dicts', () => {
    const mod1 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod-1' });
    const mod2 = createScannedModule({ ...REQUIRED_FIELDS, moduleId: 'mod-2' });

    const results = modulesToDicts([mod1, mod2]);

    expect(results).toHaveLength(2);
    expect(results[0].module_id).toBe('mod-1');
    expect(results[1].module_id).toBe('mod-2');
  });

  it('returns empty array for empty input', () => {
    expect(modulesToDicts([])).toEqual([]);
  });
});
