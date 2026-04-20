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
  if (result.verified && verifiers.length > 0) {
    const vResult = runVerifierChain(verifiers, path, moduleId);
    if (!vResult.ok) {
      return createWriteResult(moduleId, path, false, vResult.error ?? null);
    }
  }
  return result;
}
