import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  JSONVerifier,
  YAMLVerifier,
  MagicBytesVerifier,
  SyntaxVerifier,
  RegistryVerifier,
  runVerifierChain,
} from '../src/output/verifiers.js';
import type { Verifier, VerifyResult } from '../src/output/types.js';

// W20: JSONVerifier should distinguish FS read errors from JSON parse errors
describe('JSONVerifier', () => {
  it('returns ok:true for valid JSON file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-'));
    const f = path.join(tmpDir, 'test.json');
    fs.writeFileSync(f, '{"ok":true}');
    const result = new JSONVerifier().verify(f, 'mod');
    expect(result.ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns "JSON parse error" for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-'));
    const f = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(f, '{invalid}');
    const result = new JSONVerifier().verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('JSON parse error');
    expect(result.error).not.toContain('ENOENT');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // W20 regression: FS errors must NOT say "JSON parse error: ENOENT"
  it('returns "Read error" (not "JSON parse error") when file is missing', () => {
    const result = new JSONVerifier().verify('/nonexistent/file.json', 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/^JSON parse error/);
    expect(result.error).toMatch(/[Rr]ead error|ENOENT|no such file/);
  });

  // Issue #29 [D9-006]: JSONVerifier schema validation via ajv
  it('with schema: accepts valid JSON matching schema', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-schema-'));
    const f = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(f, JSON.stringify({ name: 'alice', age: 30 }));
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    };
    const result = new JSONVerifier(schema).verify(f, 'mod');
    expect(result.ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('with schema: rejects JSON that does not match schema', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-schema-'));
    const f = path.join(tmpDir, 'invalid-schema.json');
    // 'age' should be a number, but here it's a string
    fs.writeFileSync(f, JSON.stringify({ name: 'alice', age: 'not-a-number' }));
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    };
    const result = new JSONVerifier(schema).verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('with schema: rejects JSON missing required field', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-schema-'));
    const f = path.join(tmpDir, 'missing-required.json');
    fs.writeFileSync(f, JSON.stringify({ age: 30 })); // missing 'name'
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    };
    const result = new JSONVerifier(schema).verify(f, 'mod');
    expect(result.ok).toBe(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// Issue #34 [D10-009]: YAMLVerifier should check ALL entries, not just bindings[0]
describe('YAMLVerifier — all-entries check', () => {
  it('passes when all entries have module_id and target', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yv-'));
    const f = path.join(tmpDir, 'ok.binding.yaml');
    fs.writeFileSync(f, [
      'bindings:',
      '  - module_id: a.b',
      '    target: pkg:a',
      '  - module_id: c.d',
      '    target: pkg:c',
    ].join('\n'));
    const result = new YAMLVerifier().verify(f, 'mod');
    expect(result.ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when second entry is missing target (first entry is valid)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yv-'));
    const f = path.join(tmpDir, 'bad-second.binding.yaml');
    fs.writeFileSync(f, [
      'bindings:',
      '  - module_id: a.b',
      '    target: pkg:a',
      '  - module_id: c.d',
      '    target: ""',  // empty target — should fail
    ].join('\n'));
    const result = new YAMLVerifier().verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('target');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when second entry is missing module_id (first entry is valid)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yv-'));
    const f = path.join(tmpDir, 'bad-mid.binding.yaml');
    fs.writeFileSync(f, [
      'bindings:',
      '  - module_id: a.b',
      '    target: pkg:a',
      '  - target: pkg:c',  // missing module_id
    ].join('\n'));
    const result = new YAMLVerifier().verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('module_id');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// D11-007: YAMLVerifier must reject whitespace-only module_id/target
describe('YAMLVerifier — whitespace-only field rejection (D11-007)', () => {
  it('fails when module_id is whitespace-only', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yv-ws-'));
    const f = path.join(tmpDir, 'ws-mid.binding.yaml');
    fs.writeFileSync(f, [
      'bindings:',
      '  - module_id: "   "',
      '    target: pkg:func',
    ].join('\n'));
    const result = new YAMLVerifier().verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('module_id');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when target is whitespace-only', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yv-ws-'));
    const f = path.join(tmpDir, 'ws-target.binding.yaml');
    fs.writeFileSync(f, [
      'bindings:',
      '  - module_id: a.b',
      '    target: "  \t  "',
    ].join('\n'));
    const result = new YAMLVerifier().verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('target');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// W21: _flattenDiagnosticMessage cycle guard (depth limit)
describe('SyntaxVerifier', () => {
  it('returns ok:false with Read error for missing file', () => {
    const result = new SyntaxVerifier().verify('/nonexistent/file.ts', 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/[Rr]ead error|ENOENT/);
  });
});

// W22: MagicBytesVerifier should only read expected.length bytes
describe('MagicBytesVerifier', () => {
  it('returns ok:true when file starts with expected magic bytes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbv-'));
    const f = path.join(tmpDir, 'file.bin');
    fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    const result = new MagicBytesVerifier(Buffer.from([0x89, 0x50, 0x4e, 0x47])).verify(f, 'mod');
    expect(result.ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ok:false when magic bytes do not match', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbv-'));
    const f = path.join(tmpDir, 'file.bin');
    fs.writeFileSync(f, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = new MagicBytesVerifier(Buffer.from([0x89, 0x50])).verify(f, 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('magic bytes');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // W22 regression: MagicBytesVerifier correctness with partial-read implementation
  it('correctly matches partial magic bytes at the start of a large file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbv-'));
    const f = path.join(tmpDir, 'large.bin');
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    // Write magic header followed by 64KB of other data
    const body = Buffer.alloc(65536, 0xff);
    fs.writeFileSync(f, Buffer.concat([header, body]));
    const result = new MagicBytesVerifier(header).verify(f, 'mod');
    expect(result.ok).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// Issue 1 (BLOCKER): File-based verifiers must return ok:true for empty path
// (registry-backed modules have no file path — Rust has `if path.is_empty()` guards)
describe('empty-path guard — file-based verifiers', () => {
  it('YAMLVerifier returns ok=true for empty path', () => {
    const v = new YAMLVerifier();
    expect(v.verify('', 'mod_id')).toEqual({ ok: true });
  });

  it('SyntaxVerifier returns ok=true for empty path', () => {
    const v = new SyntaxVerifier();
    expect(v.verify('', 'mod_id')).toEqual({ ok: true });
  });

  it('MagicBytesVerifier returns ok=true for empty path', () => {
    const v = new MagicBytesVerifier(Buffer.from([0x89, 0x50]));
    expect(v.verify('', 'mod_id')).toEqual({ ok: true });
  });

  it('JSONVerifier returns ok=true for empty path', () => {
    const v = new JSONVerifier();
    expect(v.verify('', 'mod_id')).toEqual({ ok: true });
  });
});

// W23: runVerifierChain crash message should identify the crashing verifier
describe('runVerifierChain', () => {
  it('returns ok:true when all verifiers pass', () => {
    const v1: Verifier = { verify: () => ({ ok: true }) };
    const v2: Verifier = { verify: () => ({ ok: true }) };
    expect(runVerifierChain([v1, v2], '/path', 'mod')).toEqual({ ok: true });
  });

  it('returns first failure', () => {
    const v1: Verifier = { verify: () => ({ ok: false, error: 'first fail' }) };
    const v2: Verifier = { verify: () => ({ ok: false, error: 'second fail' }) };
    const result = runVerifierChain([v1, v2], '/path', 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('first fail');
  });

  // W23 regression: crash message must identify which verifier crashed
  it('includes verifier class name in crash message', () => {
    class ExplodingVerifier implements Verifier {
      verify(): VerifyResult { throw new Error('boom'); }
    }
    const result = runVerifierChain([new ExplodingVerifier()], '/path', 'mod');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ExplodingVerifier');
    expect(result.error).toContain('boom');
  });

  // D10-001 regression: error string MUST start with the spec-mandated literal
  // "Verifier crashed:" so cross-language callers can do
  // `result.error.startsWith("Verifier crashed")` against the Python and Rust
  // SDKs as well.
  it('uses the spec-mandated "Verifier crashed:" literal prefix', () => {
    class ExplodingVerifier implements Verifier {
      verify(): VerifyResult { throw new Error('boom'); }
    }
    const result = runVerifierChain([new ExplodingVerifier()], '/path', 'mod');
    expect(result.ok).toBe(false);
    expect(result.error?.startsWith('Verifier crashed:')).toBe(true);
  });

  // W24 regression: VerifyResult.cause should be set on crashes
  it('sets cause on crashed verifier result', () => {
    const err = new Error('root cause');
    const v: Verifier = { verify: () => { throw err; } };
    const result = runVerifierChain([v], '/path', 'mod');
    expect(result.ok).toBe(false);
    expect((result as { cause?: unknown }).cause).toBe(err);
  });
});
