// Hand-written regression tests for openapi-scanner.ts, complementing the
// shared-fixture conformance suite. These cover malformed/non-conforming
// field-type handling found by a cross-SDK audit comparing this port
// against the Python reference and Rust port.

import { describe, it, expect } from 'vitest';
import { OpenAPIScanner } from '../src/openapi-scanner.js';

const BASE = { openapi: '3.0.3', info: { title: 't', version: '1.0.0' } };

function scan(paths: Record<string, unknown>) {
  return new OpenAPIScanner().scan({ ...BASE, paths });
}

describe('OpenAPIScanner — malformed field-type handling', () => {
  it('does not treat a string "deprecated" value as deprecated (strict boolean)', () => {
    const modules = scan({
      '/widgets': { get: { deprecated: 'false', responses: { 200: { description: 'ok' } } } },
    });
    expect(modules).toHaveLength(1);
    expect(modules[0]!.annotations?.extra?.['deprecated']).not.toBe(true);
  });

  it('omits a non-string operationId from metadata.openapi.operation_id', () => {
    const modules = scan({
      '/widgets': { get: { operationId: 12345, responses: { 200: { description: 'ok' } } } },
    });
    expect(modules).toHaveLength(1);
    const openapiMeta = modules[0]!.metadata['openapi'] as Record<string, unknown>;
    expect(openapiMeta['operation_id']).toBeUndefined();
    expect(modules[0]!.moduleId).toBe('widgets.get');
  });
});
