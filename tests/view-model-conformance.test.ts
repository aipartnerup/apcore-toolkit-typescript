// Cross-SDK conformance harness for TuiViewModel — asserts the TypeScript
// impl matches the shared fixture corpus at
// apcore-toolkit/conformance/fixtures/view_model.json. The Python and Rust
// SDKs run the same fixture file through their own modulesToViewModel /
// formatViewModel and assert byte-identical JSON output for `expected`.
// This is the cross-SDK byte-identity contract for the TUI View Model
// proposal (see apcore-toolkit/docs/features/tui-view-model.md).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnnotations } from 'apcore-js';
import type { ModuleAnnotations } from 'apcore-js';

import { createScannedModule } from '../src/types.js';
import type { ScannedModule } from '../src/types.js';
import {
  modulesToViewModel,
  formatViewModel,
} from '../src/tui-view-model.js';
import type {
  Filter,
  Sort,
  TonePalette,
  View,
  GroupBy,
  Direction,
  Exposure,
} from '../src/tui-view-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'apcore-toolkit',
  'conformance',
  'fixtures',
  'view_model.json',
);

interface RawAnnotations {
  discoverable?: boolean;
  extra?: Record<string, unknown>;
}

interface RawModule {
  module_id: string;
  description?: string;
  tags?: string[];
  annotations?: RawAnnotations;
  display?: Record<string, unknown> | null;
}

interface RawFilter {
  tags?: string[];
  search?: string;
  annotations?: string[];
  exposure?: Exposure;
  deprecated?: boolean;
}

interface RawSort {
  key: string;
  direction?: Direction;
}

interface RawTonePalette {
  name: string;
  rules?: Array<{ kind?: string; value: string; tone: string }>;
}

interface RawOptions {
  view?: View;
  columns?: string[];
  title?: string;
  filter?: RawFilter;
  sort?: RawSort;
  group_by?: GroupBy;
  tone_palettes?: RawTonePalette[];
  display?: boolean;
}

interface Case {
  id: string;
  description: string;
  input: {
    modules: RawModule[];
    options?: RawOptions;
  };
  expected: string;
}

function loadCases(): Case[] {
  if (!existsSync(FIXTURE_PATH)) return [];
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { test_cases: Case[] };
  return data.test_cases;
}

function buildModule(raw: RawModule): ScannedModule {
  let annotations: ModuleAnnotations | null = null;
  if (raw.annotations) {
    annotations = createAnnotations({
      discoverable: raw.annotations.discoverable ?? true,
      extra: raw.annotations.extra ?? {},
    });
  }
  return createScannedModule({
    moduleId: raw.module_id,
    description: raw.description ?? '',
    inputSchema: {},
    outputSchema: {},
    tags: [...(raw.tags ?? [])],
    target: 'fixture:noop',
    annotations,
    display: raw.display ?? null,
  });
}

function buildFilter(raw: RawFilter | undefined): Filter | null {
  if (raw === undefined) return null;
  return {
    tags: [...(raw.tags ?? [])],
    search: raw.search ?? '',
    annotations: [...(raw.annotations ?? [])],
    exposure: raw.exposure ?? 'all',
    deprecated: raw.deprecated ?? true,
  };
}

function buildSort(raw: RawSort | undefined): Sort | null {
  if (raw === undefined) return null;
  return { key: raw.key, direction: raw.direction ?? 'asc' };
}

function buildTonePalettes(raw: RawTonePalette[] | undefined): TonePalette[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((p) => ({
    name: p.name,
    rules: (p.rules ?? []).map((r) => ({
      value: r.value,
      tone: r.tone as TonePalette['rules'][number]['tone'],
    })),
  }));
}

const cases = loadCases();

describe.skipIf(cases.length === 0)('TuiViewModel — cross-SDK conformance', () => {
  for (const tc of cases) {
    it(`${tc.id}: ${tc.description}`, () => {
      const options = tc.input.options ?? {};
      const modules = tc.input.modules.map(buildModule);

      const vm = modulesToViewModel(modules, {
        view: options.view ?? 'list',
        columns: options.columns ?? [],
        title: options.title,
        filter: buildFilter(options.filter),
        sort: buildSort(options.sort),
        groupBy: options.group_by ?? null,
        tonePalettes: buildTonePalettes(options.tone_palettes),
        display: options.display ?? true,
      });

      const actual = formatViewModel(vm);
      expect(actual, `Case ${tc.id}: ${tc.description}`).toBe(tc.expected);
    });
  }
});
