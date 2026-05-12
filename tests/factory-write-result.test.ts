/**
 * Smoke test: `createWriteResult` must be reachable from the default package
 * entry (`apcore-toolkit`), matching the README API table and the browser
 * subpath surface.
 *
 * Regression guard for B-T-002 — earlier releases re-exported the symbol from
 * `apcore-toolkit/browser` only, so `import { createWriteResult } from
 * 'apcore-toolkit'` failed at runtime even though the README advertised it
 * as a default-entry export.
 */

import { describe, it, expect } from 'vitest';
import { createWriteResult } from '../src/index.js';

describe('createWriteResult — main entry re-export (B-T-002)', () => {
  it('is exported from the default package entry', () => {
    expect(typeof createWriteResult).toBe('function');
  });

  it('constructs a WriteResult with the documented defaults', () => {
    const r = createWriteResult('mod-1');
    expect(r).toEqual({
      moduleId: 'mod-1',
      path: null,
      verified: true,
      verificationError: null,
    });
  });

  it('honours explicit arguments', () => {
    const r = createWriteResult('mod-2', '/tmp/x.yaml', false, 'boom');
    expect(r).toEqual({
      moduleId: 'mod-2',
      path: '/tmp/x.yaml',
      verified: false,
      verificationError: 'boom',
    });
  });
});
