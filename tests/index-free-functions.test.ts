/**
 * Issue #6 [D1-001] regression: package-level free-function exports for
 * filterModules, deduplicateIds, and inferAnnotationsFromMethod.
 *
 * Python and Rust export these as package-level symbols; TypeScript must too.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_ANNOTATIONS } from 'apcore-js';
import {
  filterModules,
  deduplicateIds,
  inferAnnotationsFromMethod,
  createScannedModule,
} from '../src/index.js';
import type { ScannedModule } from '../src/index.js';

function makeModule(id: string): ScannedModule {
  return createScannedModule({
    moduleId: id,
    description: `Module ${id}`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    tags: [],
    target: `http://localhost/${id}`,
  });
}

describe('filterModules (package-level free function)', () => {
  const modules = [
    makeModule('users.list'),
    makeModule('users.create'),
    makeModule('orders.list'),
  ];

  it('is callable directly from the package root (no BaseScanner instance needed)', () => {
    // The key assertion: filterModules is a standalone function exported from index
    expect(typeof filterModules).toBe('function');
  });

  it('returns all modules when no patterns provided', () => {
    expect(filterModules(modules)).toHaveLength(3);
  });

  it('filters with include pattern', () => {
    const result = filterModules(modules, '^users');
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.moduleId)).toEqual(['users.list', 'users.create']);
  });

  it('filters with exclude pattern', () => {
    const result = filterModules(modules, undefined, 'create');
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.moduleId)).toEqual(['users.list', 'orders.list']);
  });

  it('filters with both include and exclude', () => {
    const result = filterModules(modules, 'users', 'create');
    expect(result).toHaveLength(1);
    expect(result[0].moduleId).toBe('users.list');
  });
});

describe('deduplicateIds (package-level free function)', () => {
  it('is callable directly from the package root', () => {
    expect(typeof deduplicateIds).toBe('function');
  });

  it('renames colliding IDs with a numeric suffix', () => {
    const modules = [makeModule('mod-a'), makeModule('mod-a'), makeModule('mod-b')];
    const result = deduplicateIds(modules);
    expect(result).toHaveLength(3);
    expect(result[0].moduleId).toBe('mod-a');
    expect(result[1].moduleId).toBe('mod-a_2');
    expect(result[2].moduleId).toBe('mod-b');
  });

  it('returns same array length for no-duplicate input', () => {
    const modules = [makeModule('a'), makeModule('b'), makeModule('c')];
    const result = deduplicateIds(modules);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.moduleId)).toEqual(['a', 'b', 'c']);
  });
});

describe('inferAnnotationsFromMethod (package-level free function)', () => {
  it('is callable directly from the package root', () => {
    expect(typeof inferAnnotationsFromMethod).toBe('function');
  });

  it('GET → readonly=true, cacheable=true', () => {
    const ann = inferAnnotationsFromMethod('GET');
    expect(ann).toEqual({ ...DEFAULT_ANNOTATIONS, readonly: true, cacheable: true });
  });

  it('DELETE → destructive=true', () => {
    const ann = inferAnnotationsFromMethod('DELETE');
    expect(ann).toEqual({ ...DEFAULT_ANNOTATIONS, destructive: true });
  });

  it('PUT → idempotent=true', () => {
    const ann = inferAnnotationsFromMethod('PUT');
    expect(ann).toEqual({ ...DEFAULT_ANNOTATIONS, idempotent: true });
  });

  it('POST → all defaults', () => {
    const ann = inferAnnotationsFromMethod('POST');
    expect(ann).toEqual({ ...DEFAULT_ANNOTATIONS });
  });
});
