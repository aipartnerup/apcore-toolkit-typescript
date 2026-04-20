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

  // W24 regression: VerifyResult.cause should be set on crashes
  it('sets cause on crashed verifier result', () => {
    const err = new Error('root cause');
    const v: Verifier = { verify: () => { throw err; } };
    const result = runVerifierChain([v], '/path', 'mod');
    expect(result.ok).toBe(false);
    expect((result as { cause?: unknown }).cause).toBe(err);
  });
});
