// Cross-SDK conformance harness for DisplayResolver — asserts TS impl
// matches the shared fixture corpus at
// apcore-toolkit/conformance/fixtures/display_resolve.json. Python and Rust
// SDKs run the same fixture through their own DisplayResolver and assert
// identical resolved output. This is the cross-SDK behavioral contract for
// the display-overlay resolution priority chain.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DisplayResolver } from '../src/display/resolver.js';
import { createScannedModule } from '../src/types.js';
import type { ScannedModule } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'apcore-toolkit',
  'conformance',
  'fixtures',
  'display_resolve.json',
);

interface ModuleShape {
  module_id: string;
  description?: string;
  documentation?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  target?: string;
}

interface Case {
  id: string;
  description: string;
  input: {
    scanned_module?: ModuleShape;
    scanned_modules?: ModuleShape[];
    binding_map: Record<string, unknown>;
    surface?: string;
    cli_alias_explicit?: boolean;
  };
  expected: {
    display?: Record<string, unknown>;
    results?: Array<{ module_id: string; display: Record<string, unknown> }>;
    error?: string;
    surface?: string;
    reason?: string;
    warning?: string;
  };
}

function loadCases(): Case[] {
  if (!existsSync(FIXTURE_PATH)) return [];
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { test_cases: Case[] };
  return data.test_cases;
}

function buildModule(raw: ModuleShape): ScannedModule {
  return createScannedModule({
    moduleId: raw.module_id,
    description: raw.description ?? '',
    documentation: raw.documentation ?? null,
    tags: [...(raw.tags ?? [])],
    metadata: { ...(raw.metadata ?? {}) },
    inputSchema: raw.input_schema ?? {},
    outputSchema: raw.output_schema ?? {},
    target: raw.target ?? 'fixture:noop',
  });
}

function assertPartialMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined,
  path = 'display',
): void {
  expect(actual, `${path} should be defined`).toBeDefined();
  for (const [key, expVal] of Object.entries(expected)) {
    expect(actual, `${path}.${key} parent`).toBeDefined();
    const actVal = (actual as Record<string, unknown>)[key];
    if (expVal !== null && typeof expVal === 'object' && !Array.isArray(expVal)) {
      assertPartialMatch(
        expVal as Record<string, unknown>,
        actVal as Record<string, unknown> | undefined,
        `${path}.${key}`,
      );
    } else {
      expect(actVal, `${path}.${key}`).toStrictEqual(expVal);
    }
  }
}

const cases = loadCases();

describe.skipIf(cases.length === 0)('DisplayResolver — cross-SDK conformance', () => {
  for (const tc of cases) {
    it(`${tc.id}: ${tc.description}`, () => {
      const resolver = new DisplayResolver();
      const bindingMap = tc.input.binding_map as Record<string, unknown>;

      if (tc.expected.error) {
        const module = buildModule(tc.input.scanned_module!);
        expect(() => resolver.resolve([module], { bindingData: bindingMap })).toThrow();
        return;
      }

      if (tc.input.scanned_modules) {
        const modules = tc.input.scanned_modules.map(buildModule);
        const resolved = resolver.resolve(modules, { bindingData: bindingMap });
        for (const expResult of tc.expected.results ?? []) {
          const mod = resolved.find((m) => m.moduleId === expResult.module_id);
          expect(mod, `module ${expResult.module_id}`).toBeDefined();
          const display = mod!.metadata?.['display'] as Record<string, unknown> | undefined;
          assertPartialMatch(expResult.display, display);
        }
        return;
      }

      const module = buildModule(tc.input.scanned_module!);
      const resolved = resolver.resolve([module], { bindingData: bindingMap });
      const display = resolved[0].metadata?.['display'] as Record<string, unknown> | undefined;
      assertPartialMatch(tc.expected.display ?? {}, display);
    });
  }
});
