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

  it('runs custom verifier chain when verify=false but verifiers provided', () => {
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [failVerifier], '/tmp/f', 'mod', false);
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

  it('returns first failure from custom verifier chain', () => {
    const v1: Verifier = { verify: () => ({ ok: false, error: 'first' }) };
    const v2: Verifier = { verify: () => ({ ok: false, error: 'second' }) };
    const result = createWriteResult('mod', '/tmp/f');
    const out = applyVerification(result, passVerifier, [v1, v2], '/tmp/f', 'mod', false);
    expect(out.verificationError).toBe('first');
  });
});
