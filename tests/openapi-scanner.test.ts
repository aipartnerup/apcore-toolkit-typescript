// Hand-written regression tests for openapi-scanner.ts, complementing the
// shared-fixture conformance suite. These cover malformed/non-conforming
// field-type handling found by a cross-SDK audit comparing this port
// against the Python reference and Rust port.

import { describe, it, expect } from 'vitest';
import { OpenAPIScanner, deriveModuleId } from '../src/openapi-scanner.js';

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

  // Regression: SANITIZE_RE (`/[^A-Za-z0-9_.-]/g`) had no `u` flag, so it
  // matched UTF-16 code UNITS rather than Unicode code POINTS. A non-BMP
  // character (e.g. an emoji, encoded as a UTF-16 surrogate pair) was
  // matched — and replaced with `_` — twice, once per surrogate half.
  // Python's code-point-based `re` and Rust's Unicode-scalar-based `regex`
  // crate each produce exactly one `_` for the same input, so this broke
  // the documented byte-for-byte cross-SDK `derive_module_id` guarantee.
  it('sanitizes a non-BMP character (emoji) in operationId to exactly one underscore', () => {
    // The emoji sits mid-string (not at either end) so a leading/trailing
    // `_`-trim in sanitize() can't mask a double-underscore regression.
    const id = deriveModuleId('/widgets', 'get', { operationId: 'create\u{1F600}User' });
    expect(id).toBe('create_User');
  });
});
