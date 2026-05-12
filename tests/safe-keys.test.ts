/**
 * Isolated regression lock for `PROTO_DENY`.
 *
 * `src/safe-keys.ts` is the JavaScript-specific prototype-pollution guard used
 * by `DisplayResolver` (and any future caller). It is currently exercised
 * transitively via display-resolver tests, but a typo or accidental deletion
 * in the deny list would slip past those if the resolver also drifts. This
 * file pins the contract directly so the surface cannot regress silently.
 */

import { describe, it, expect } from 'vitest';
import { PROTO_DENY } from '../src/safe-keys.js';

describe('PROTO_DENY — prototype-pollution deny list (B-T-008)', () => {
  it('is a Set', () => {
    expect(PROTO_DENY).toBeInstanceOf(Set);
  });

  it('contains the three canonical dangerous keys', () => {
    expect(PROTO_DENY.has('__proto__')).toBe(true);
    expect(PROTO_DENY.has('prototype')).toBe(true);
    expect(PROTO_DENY.has('constructor')).toBe(true);
  });

  it('does not contain incidental keys', () => {
    expect(PROTO_DENY.has('toString')).toBe(false);
    expect(PROTO_DENY.has('hasOwnProperty')).toBe(false);
    expect(PROTO_DENY.has('')).toBe(false);
  });
});
