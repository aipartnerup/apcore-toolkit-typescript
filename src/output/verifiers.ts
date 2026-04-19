import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import type { Verifier, VerifyResult } from './types.js';

const _require = createRequire(import.meta.url);

function loadTypeScript(): typeof import('typescript') | null {
  try {
    return _require('typescript') as typeof import('typescript');
  } catch {
    return null;
  }
}

export class YAMLVerifier implements Verifier {
  verify(path: string, _moduleId: string): VerifyResult {
    try {
      const content = readFileSync(path, 'utf-8');
      const doc = yaml.load(content) as Record<string, unknown>;
      if (doc == null || typeof doc !== 'object') {
        return { ok: false, error: 'YAML parsed to non-object value' };
      }
      if (!('bindings' in doc)) {
        return { ok: false, error: 'Missing required "bindings" key' };
      }
      const first = (doc as any).bindings[0];
      if (!first) return { ok: false, error: 'bindings array is empty' };
      for (const field of ['module_id', 'target'] as const) {
        if (!first[field]) return { ok: false, error: `Missing required field '${field}' in first binding` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `YAML parse error: ${(err as Error).message}` };
    }
  }
}

export class SyntaxVerifier implements Verifier {
  verify(path: string, _moduleId: string): VerifyResult {
    try {
      const content = readFileSync(path, 'utf-8');
      if (content.trim().length === 0) {
        return { ok: false, error: 'File is empty' };
      }
      // Use the TypeScript compiler to parse and check for syntax errors.
      const ts = loadTypeScript();
      if (ts === null) {
        return { ok: false, error: 'typescript package required for syntax verification' };
      }
      const sourceFile = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true);
      const diagnostics = (sourceFile as any).parseDiagnostics as Array<{ messageText: string | { messageText: string } }> | undefined;
      if (diagnostics && diagnostics.length > 0) {
        const msg = diagnostics[0].messageText;
        const text = typeof msg === 'string' ? msg : msg.messageText;
        return { ok: false, error: `Syntax error: ${text}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Read error: ${(err as Error).message}` };
    }
  }
}

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
      return { ok: false, error: `Registry lookup error: ${(err as Error).message}` };
    }
  }
}

export class MagicBytesVerifier implements Verifier {
  private readonly expected: Buffer;

  constructor(expected: Buffer) {
    this.expected = expected;
  }

  verify(path: string, _moduleId: string): VerifyResult {
    try {
      const content = readFileSync(path);
      const header = content.subarray(0, this.expected.length);
      if (!header.equals(this.expected)) {
        return { ok: false, error: 'File header does not match expected magic bytes' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Read error: ${(err as Error).message}` };
    }
  }
}

export class JSONVerifier implements Verifier {
  private readonly schema: Record<string, unknown> | null;

  constructor(schema?: Record<string, unknown>) {
    this.schema = schema ?? null;
  }

  verify(path: string, _moduleId: string): VerifyResult {
    try {
      const content = readFileSync(path, 'utf-8');
      JSON.parse(content);
      if (this.schema != null) {
        // Schema validation requires ajv — the schema parameter was provided but
        // cannot be validated without ajv installed.
        return {
          ok: false,
          error:
            'JSONVerifier schema validation not implemented — install ajv and update JSONVerifier.verify()',
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `JSON parse error: ${(err as Error).message}` };
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
      return { ok: false, error: `Verifier crashed: ${(e as Error).message}` };
    }
  }
  return { ok: true };
}
