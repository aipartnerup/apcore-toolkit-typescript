import { describe, it, expect } from 'vitest';
import { applyVerification } from '../src/output/base-writer.js';
import { createWriteResult } from '../src/output/types.js';
import type { Verifier } from '../src/output/types.js';

const passVerifier: Verifier = { verify: () => ({ ok: true }) };
const failVerifier: Verifier = { verify: () => ({ ok: false, error: 'failed' }) };

describe('applyVerification', () => {
  it('returns result unchanged when verify=false and no verifiers', () => {
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [], '/tmp/f', 'mod', false);
    expect(out).toBe(result);
  });

  it('runs builtin verifier when verify=true and returns success', () => {
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [], '/tmp/f', 'mod', true);
    expect(out.verified).toBe(true);
  });

  it('records failure when builtin verifier fails', () => {
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, failVerifier, [], '/tmp/f', 'mod', true);
    expect(out.verified).toBe(false);
    expect(out.verificationError).toBe('failed');
  });

  // D11-011: custom verifiers run independently of the built-in verify flag
  // (matches Python/Rust behavior where custom verifiers always run if provided)
  it('runs custom verifier chain even when verify=false (D11-011)', () => {
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [failVerifier], '/tmp/f', 'mod', false);
    // verify=false skips built-in verification, but custom verifiers still run
    expect(out.verified).toBe(false);
    expect(out.verificationError).toBe('failed');
  });

  it('runs custom verifier chain when verify=true and builtin passes', () => {
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [failVerifier], '/tmp/f', 'mod', true);
    expect(out.verified).toBe(false);
    expect(out.verificationError).toBe('failed');
  });

  it('skips custom chain when builtin already failed', () => {
    let customCalled = false;
    const customVerifier: Verifier = { verify: () => { customCalled = true; return { ok: false, error: 'custom' }; } };
    const result = createWriteResult('mod', '/tmp/f');
    applyVerification(result, failVerifier, [customVerifier], '/tmp/f', 'mod', true);
    expect(customCalled).toBe(false);
  });

  it('returns first failure from custom verifier chain when verify=true', () => {
    const v1: Verifier = { verify: () => ({ ok: false, error: 'first' }) };
    const v2: Verifier = { verify: () => ({ ok: false, error: 'second' }) };
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [v1, v2], '/tmp/f', 'mod', true);
    expect(out.verificationError).toBe('first');
  });
});
