// Cross-SDK conformance harness for OpenAPIScanner — asserts the
// TypeScript impl matches the shared fixture corpus at
// apcore-toolkit/conformance/fixtures/openapi_scan.json. The Python and
// Rust SDKs run the same fixture file through their own OpenAPIScanner and
// assert structurally identical (parsed-JSON deep equality) module lists —
// unlike view_model.json, `expected` here is a structured object, not a
// canonical string, since ScannedModule output is compared field-by-field
// rather than byte-for-byte. See
// apcore-toolkit/docs/features/openapi-scanner.md.
//
// Fixture cases openapi_scan_021 through openapi_scan_023 install a named
// test-only hook from HOOKS below — the fixture's `input.hooks` key names
// which one, so all three SDKs install byte-identical hook behavior
// without serializing a callable through JSON. Mirrors
// apcore-toolkit-python/tests/test_openapi_scan_conformance.py.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAPIScanner, InvalidSpecError } from '../src/openapi-scanner.js';
import type { OpenAPIScanOptions } from '../src/openapi-scanner.js';
import type { ScannedModule } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'apcore-toolkit',
  'conformance',
  'fixtures',
  'openapi_scan.json',
);

interface Case {
  id: string;
  description: string;
  input: {
    spec: Record<string, unknown>;
    options?: Record<string, unknown>;
    hooks?: Record<string, string>;
  };
  expected: {
    modules?: unknown[];
    raises?: string;
  };
}

function loadCases(): Case[] {
  if (!existsSync(FIXTURE_PATH)) return [];
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { test_cases: Case[] };
  return data.test_cases;
}

function skipIfXSkipTrue(
  _path: string,
  _method: string,
  operation: Record<string, unknown>,
): Record<string, unknown> | null {
  return operation['x-skip'] ? null : operation;
}

function customNameForOperationIdCustomElseDefault(
  _path: string,
  _method: string,
  operation: Record<string, unknown>,
): string | null {
  return operation['operationId'] === 'custom' ? 'custom.name' : null;
}

function alwaysReturnsDupOp(): string {
  return 'dup.op';
}

const HOOKS: Record<string, [keyof OpenAPIScanOptions, unknown]> = {
  skip_if_x_skip_true: ['transformOperation', skipIfXSkipTrue],
  custom_name_for_operation_id_custom_else_default: ['deriveModuleId', customNameForOperationIdCustomElseDefault],
  always_returns_dup_op: ['deriveModuleId', alwaysReturnsDupOp],
};

// snake_case fixture option keys -> camelCase OpenAPIScanOptions keys.
// None of the 24 fixture cases currently populate real filter/exclude
// options (only the empty `{}` used by the hook cases), but this keeps the
// harness correct if that changes.
const OPTION_KEY_MAP: Record<string, keyof OpenAPIScanOptions> = {
  include: 'include',
  exclude: 'exclude',
  base_path_prefix: 'basePathPrefix',
  include_deprecated: 'includeDeprecated',
};

function moduleRepr(m: ScannedModule): Record<string, unknown> {
  const ann = m.annotations;
  const annDict: Record<string, unknown> = {};
  if (ann) {
    for (const flag of ['readonly', 'destructive', 'idempotent', 'cacheable'] as const) {
      if (ann[flag]) annDict[flag] = true;
    }
    if (ann.extra && Object.keys(ann.extra).length > 0) {
      annDict['extra'] = ann.extra;
    }
  }
  return {
    module_id: m.moduleId,
    description: m.description,
    documentation: m.documentation,
    tags: m.tags,
    version: m.version,
    target: m.target,
    annotations: annDict,
    metadata: m.metadata,
    input_schema: m.inputSchema,
    output_schema: m.outputSchema,
    warnings: m.warnings,
  };
}

const cases = loadCases();

describe.skipIf(cases.length === 0)('OpenAPIScanner — cross-SDK conformance', () => {
  for (const tc of cases) {
    it(`${tc.id}: ${tc.description}`, () => {
      const spec = tc.input.spec;
      const options: OpenAPIScanOptions = {};
      for (const [rawKey, rawVal] of Object.entries(tc.input.options ?? {})) {
        const mapped = OPTION_KEY_MAP[rawKey];
        if (mapped) {
          (options as Record<string, unknown>)[mapped] = rawVal;
        }
      }
      for (const [hookKey, hookName] of Object.entries(tc.input.hooks ?? {})) {
        void hookKey;
        const entry = HOOKS[hookName];
        if (!entry) throw new Error(`unknown fixture hook name: ${hookName}`);
        const [optKey, fn] = entry;
        (options as Record<string, unknown>)[optKey] = fn;
      }

      const scanner = new OpenAPIScanner();

      if (tc.expected.raises) {
        expect(() => scanner.scan(spec, options)).toThrow(InvalidSpecError);
        return;
      }

      const modules = scanner.scan(spec, options);
      const actual = modules.map(moduleRepr);
      expect(actual, `Case ${tc.id}: ${tc.description}`).toEqual(tc.expected.modules);
    });
  }
});
