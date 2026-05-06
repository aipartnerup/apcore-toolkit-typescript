import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import type { default as AjvType } from 'ajv';
import type { Verifier, VerifyResult } from './types.js';

// Re-export runtime-neutral verifier primitives so downstream imports from
// this file (internal and the default package entry) continue to work while
// the browser subpath imports them directly from `verify-core.js` without
// dragging in the Node-only code below.
export { RegistryVerifier, runVerifierChain } from './verify-core.js';

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
      const bindings = (doc as Record<string, unknown>).bindings;
      if (!Array.isArray(bindings) || bindings.length === 0) {
        return { ok: false, error: 'bindings array is empty' };
      }
      for (let i = 0; i < bindings.length; i++) {
        const entry = bindings[i] as Record<string, unknown>;
        for (const field of ['module_id', 'target'] as const) {
          if (typeof entry[field] !== 'string' || (entry[field] as string).trim() === '') {
            return { ok: false, error: `Missing or empty required field '${field}' in binding[${i}]` };
          }
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `YAML parse error: ${(err as Error).message}`, cause: err };
    }
  }
}

function _flattenDiagnosticMessage(msg: unknown, depth = 0): string {
  if (depth > 32) return '[...]';
  if (typeof msg === 'string') return msg;
  if (typeof msg === 'object' && msg !== null && 'messageText' in msg) {
    const chain = msg as { messageText: unknown; next?: unknown[] };
    const parts = [_flattenDiagnosticMessage(chain.messageText, depth + 1)];
    if (Array.isArray(chain.next)) {
      for (const sub of chain.next) {
        parts.push(_flattenDiagnosticMessage(sub, depth + 1));
      }
    }
    return parts.join(': ');
  }
  return String(msg);
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
      const program = ts.createProgram([path], {
        noLib: true,
        noResolve: true,
        skipLibCheck: true,
        strict: false,
      });
      const sourceFile = program.getSourceFile(path);
      if (!sourceFile) {
        return { ok: false, error: 'TypeScript compiler could not load file' };
      }
      const diagnostics = program.getSyntacticDiagnostics(sourceFile);
      if (diagnostics.length > 0) {
        const text = _flattenDiagnosticMessage(diagnostics[0].messageText);
        return { ok: false, error: `Syntax error: ${text}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Read error: ${(err as Error).message}`, cause: err };
    }
  }
}

export class MagicBytesVerifier implements Verifier {
  private readonly expected: Buffer;

  constructor(expected: Buffer) {
    this.expected = expected;
  }

  verify(path: string, _moduleId: string): VerifyResult {
    let fd: number | undefined;
    try {
      fd = openSync(path, 'r');
      const buf = Buffer.alloc(this.expected.length);
      const bytesRead = readSync(fd, buf, 0, this.expected.length, 0);
      if (bytesRead < this.expected.length || !buf.equals(this.expected)) {
        return { ok: false, error: 'File header does not match expected magic bytes' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Read error: ${(err as Error).message}`, cause: err };
    } finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
    }
  }
}

export class JSONVerifier implements Verifier {
  private readonly _ajv: AjvType | null = null;
  private readonly _schema: Record<string, unknown> | null = null;

  constructor(schema?: Record<string, unknown>) {
    if (schema != null) {
      // `strict: false` keeps v6-compatible permissive behaviour for
      // schemas that may include vendor extensions or unknown keywords;
      // tightening the schema is the schema author's responsibility.
      this._ajv = new Ajv({ strict: false });
      this._schema = schema;
    }
  }

  verify(path: string, _moduleId: string): VerifyResult {
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch (err) {
      return { ok: false, error: `Read error: ${(err as Error).message}`, cause: err };
    }
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (err) {
      return { ok: false, error: `JSON parse error: ${(err as Error).message}`, cause: err };
    }
    if (this._ajv && this._schema) {
      const valid = this._ajv.validate(this._schema, data);
      if (!valid) {
        return { ok: false, error: this._ajv.errorsText() };
      }
    }
    return { ok: true };
  }
}

