// Tri-language parity note
// ------------------------
// This file (`base-writer.ts`) and `factory.ts` expose shared write-option
// shapes and a verify-chain helper as TypeScript-specific abstractions.
// Python and Rust deliberately do not have equivalents: Python writers
// accept **kwargs directly and Rust uses a format-variant enum returned
// from `get_writer`. The TS pattern exists because structural typing
// makes a shared options interface cheaper to maintain than per-writer
// duplicates. Keep the surface internal to this subdirectory — avoid
// re-exporting from the package entry point.

import type { Verifier, VerifyResult, WriteResult } from './types.js';
import { createWriteResult } from './types.js';
import { runVerifierChain } from './verifiers.js';

export interface BaseWriteOptions {
  dryRun?: boolean;
  verify?: boolean;
  verifiers?: Verifier[];
}

export interface FileWriteOptions extends BaseWriteOptions {
  errorMode?: 'throw' | 'collect';
}

/**
 * Apply built-in and custom verifiers to a WriteResult.
 *
 * Runs `builtinVerifier` first (if `verify` is true), then `verifiers`
 * chain. Returns a new WriteResult with the first failure recorded.
 */
export function applyVerification(
  result: WriteResult,
  builtinVerifier: Verifier,
  verifiers: Verifier[],
  path: string,
  moduleId: string,
  verify: boolean,
): WriteResult {
  if (verify) {
    const builtinResult: VerifyResult = builtinVerifier.verify(path, moduleId);
    if (!builtinResult.ok) {
      return createWriteResult(moduleId, path, false, builtinResult.error ?? null);
    }
  }
  if (verify && verifiers.length > 0) {
    const vResult = runVerifierChain(verifiers, path, moduleId);
    if (!vResult.ok) {
      return createWriteResult(moduleId, path, false, vResult.error ?? null);
    }
  }
  return result;
}
