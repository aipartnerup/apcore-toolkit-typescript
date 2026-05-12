import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatCsv, formatJsonl } from '../src/formatting/tabular.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_DIR = resolve(
  __dirname,
  '..',
  '..',
  'apcore-toolkit',
  'conformance',
  'fixtures',
);

interface ConformanceCase {
  id: string;
  description: string;
  input: { rows: Record<string, unknown>[]; bom?: boolean };
  expected: string;
}

interface ConformanceFile {
  test_cases: ConformanceCase[];
}

function loadFixture(name: string): ConformanceCase[] {
  const path = resolve(CONFORMANCE_DIR, name);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8')) as ConformanceFile;
  return data.test_cases;
}

describe('formatCsv — local unit tests', () => {
  it('returns empty string for empty input', () => {
    expect(formatCsv([])).toBe('');
  });

  it('renders single row with CRLF', () => {
    expect(formatCsv([{ a: 1, b: 2 }])).toBe('a,b\r\n1,2\r\n');
  });

  it('regression: heterogeneous keys — later-row extras included', () => {
    expect(formatCsv([{ a: 1 }, { a: 2, b: 3 }])).toBe('a,b\r\n1,\r\n2,3\r\n');
  });

  it('regression: nested object serializes as canonical JSON', () => {
    const result = formatCsv([
      { schema: { type: 'object', properties: { a: { type: 'integer' } } } },
    ]);
    const cell = result.split('\r\n')[1];
    const unwrapped = cell.slice(1, -1).replace(/""/g, '"');
    expect(JSON.parse(unwrapped)).toEqual({
      type: 'object',
      properties: { a: { type: 'integer' } },
    });
  });

  it('RFC 4180: quote, newline, comma escaping', () => {
    expect(formatCsv([{ a: 'x,y' }])).toBe('a\r\n"x,y"\r\n');
    expect(formatCsv([{ a: 'she said "hi"' }])).toBe('a\r\n"she said ""hi"""\r\n');
    expect(formatCsv([{ a: 'line1\nline2' }])).toBe('a\r\n"line1\nline2"\r\n');
  });

  it('scalar types', () => {
    expect(formatCsv([{ n: null, b: true, f: false, i: 42, fw: 1.0, ff: 1.5 }]))
      .toBe('n,b,f,i,fw,ff\r\n,true,false,42,1,1.5\r\n');
  });

  it('NaN/Infinity emit empty cells', () => {
    expect(formatCsv([{ a: NaN, b: Infinity }])).toBe('a,b\r\n,\r\n');
  });

  it('BOM option', () => {
    expect(formatCsv([{ a: 1 }], { bom: true })).toBe('\uFEFFa\r\n1\r\n');
    expect(formatCsv([{ a: 1 }])).toBe('a\r\n1\r\n');
  });
});

describe('formatJsonl — local unit tests', () => {
  it('returns empty string for empty input', () => {
    expect(formatJsonl([])).toBe('');
  });

  it('LF terminator, no trailing blank', () => {
    expect(formatJsonl([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}\n');
  });

  it('compact: no spaces between separators', () => {
    const r = formatJsonl([{ a: 1, b: 2 }]);
    expect(r).not.toContain(', ');
    expect(r).not.toContain(': ');
  });

  it('nested value preserved', () => {
    expect(formatJsonl([{ schema: { type: 'object' } }])).toBe(
      '{"schema":{"type":"object"}}\n',
    );
  });
});

const csvCases = loadFixture('format_csv.json');
describe.skipIf(csvCases.length === 0)('formatCsv — cross-SDK conformance', () => {
  csvCases.forEach((tc) => {
    it(`${tc.id}: ${tc.description}`, () => {
      const actual = formatCsv(tc.input.rows, { bom: tc.input.bom ?? false });
      expect(actual).toBe(tc.expected);
    });
  });
});

const jsonlCases = loadFixture('format_jsonl.json');
describe.skipIf(jsonlCases.length === 0)('formatJsonl — cross-SDK conformance', () => {
  jsonlCases.forEach((tc) => {
    it(`${tc.id}: ${tc.description}`, () => {
      const actual = formatJsonl(tc.input.rows);
      expect(actual).toBe(tc.expected);
    });
  });
});
