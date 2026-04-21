// Runtime-neutral verifier primitives.
//
// This module contains the `Verifier` implementations and combinators that
// do not touch the filesystem or any other Node-only API. They live here so
// the browser subpath entry (`apcore-toolkit/browser`) can expose them
// without transitively dragging in `node:fs` / `node:module` from the
// file-based verifiers (`YAMLVerifier`, `SyntaxVerifier`, `MagicBytesVerifier`,
// `JSONVerifier`) that share the original `verifiers.ts` file.
//
// `verifiers.ts` continues to re-export `RegistryVerifier` and
// `runVerifierChain` from here, so the default package entry point's public
// API is unchanged.

import type { Verifier, VerifyResult } from './types.js';

export class RegistryVerifier implements Verifier {
  private readonly registry: { getModule?(id: string): unknown };

  constructor(registry: { getModule?(id: string): unknown }) {
    this.registry = registry;
  }

  verify(_path: string, moduleId: string): VerifyResult {
    try {
      if (typeof this.registry.getModule !== 'function') {
        return { ok: false, error: 'Registry does not have a getModule method' };
      }
      const mod = this.registry.getModule(moduleId);
      if (mod == null) {
        return { ok: false, error: `Module "${moduleId}" not found in registry` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Registry lookup error: ${(err as Error).message}`, cause: err };
    }
  }
}

/**
 * Run a chain of verifiers in order, returning the first failure.
 * If a verifier throws an exception, it is caught and returned as a failure
 * with the prefix "Verifier crashed:".
 *
 * @param verifiers - Ordered list of verifiers to run.
 * @param path - File path to verify.
 * @param moduleId - Module ID being verified.
 * @returns The first failed VerifyResult, or { ok: true } if all pass.
 */
export function runVerifierChain(
  verifiers: Verifier[],
  path: string,
  moduleId: string,
): VerifyResult {
  for (const verifier of verifiers) {
    try {
      const result = verifier.verify(path, moduleId);
      if (!result.ok) return result;
    } catch (e) {
      const name = verifier.constructor?.name ?? 'UnknownVerifier';
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `${name} crashed: ${msg}`, cause: e };
    }
  }
  return { ok: true };
}
