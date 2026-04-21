/**
 * HTTP proxy registry writer.
 *
 * Registers scanned modules as HTTP proxy classes that forward requests
 * to a running web API. This enables CLI execution without invoking
 * route handlers directly (which depend on framework DI systems).
 *
 * Uses the global `fetch` available in Node 20+ — no additional
 * dependency required. Mirrors Python's `HTTPProxyRegistryWriter` in
 * `apcore_toolkit/output/http_proxy_writer.py` and Rust's
 * `HTTPProxyRegistryWriter` under the `http-proxy` feature flag.
 *
 * @example
 * ```ts
 * import { HTTPProxyRegistryWriter } from 'apcore-toolkit';
 *
 * const writer = new HTTPProxyRegistryWriter({
 *   baseUrl: 'http://localhost:8000',
 *   authHeaderFactory: () => ({ Authorization: 'Bearer xxx' }),
 * });
 * const results = await writer.write(modules, registry);
 * ```
 */

import {
  ErrorCodes,
  FunctionModule,
  jsonSchemaToTypeBox,
  ModuleError,
} from 'apcore-js';
import type { Context, ModuleExample } from 'apcore-js';

import { extractPathParamNames, substitutePathParams } from '../http-verb-map.js';
import type { ScannedModule } from '../types.js';
import type { WriteResult } from './types.js';
import { createWriteResult } from './types.js';

/** HTTP methods that conventionally carry a JSON request body. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Shape of a registry that `HTTPProxyRegistryWriter` writes to.
 *
 * Mirrors the minimal surface used by `RegistryWriter.write()`.
 */
export interface ProxyRegistry {
  register(moduleId: string, module: unknown): void;
}

/**
 * Constructor options for {@link HTTPProxyRegistryWriter}.
 */
export interface HTTPProxyRegistryWriterOptions {
  /** Base URL of the target API (e.g. `http://localhost:8000`). */
  baseUrl: string;
  /**
   * Optional callable returning HTTP headers for authentication
   * (e.g. `{ Authorization: 'Bearer xxx' }`). Called once per request.
   */
  authHeaderFactory?: () => Record<string, string>;
  /** HTTP request timeout in milliseconds. Defaults to 60_000 (60s). */
  timeoutMs?: number;
  /**
   * Optional fetch implementation (primarily for tests). Defaults to the
   * global `fetch` available in Node 20+.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Error thrown when HTTP fields (method / path) cannot be extracted from
 * a ScannedModule.
 */
export class HTTPProxyWriterError extends Error {
  constructor(moduleId: string, message: string) {
    super(`[${moduleId}] ${message}`);
    this.name = 'HTTPProxyWriterError';
  }
}

interface HttpFields {
  httpMethod: string;
  urlPath: string;
}

function getHttpFields(mod: ScannedModule): HttpFields {
  const metadata = (mod.metadata ?? {}) as Record<string, unknown>;
  const m = (mod as unknown as { httpMethod?: unknown }).httpMethod;
  const httpMethod = (typeof m === 'string' && m) || (typeof metadata.httpMethod === 'string' && metadata.httpMethod) || 'GET';
  const p = (mod as unknown as { urlPath?: unknown }).urlPath;
  let urlPath = (typeof p === 'string' && p) || (typeof metadata.urlPath === 'string' && metadata.urlPath) || '/';
  urlPath = String(urlPath);
  if (/^(https?|file|ftp):\/\//i.test(urlPath)) {
    throw new HTTPProxyWriterError(
      mod.moduleId,
      `url_path must be a relative path, not an absolute URL: ${JSON.stringify(urlPath)}`,
    );
  }
  return { httpMethod: String(httpMethod), urlPath };
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const base = baseUrl.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

function extractErrorMessage(resp: Response, text: string): string {
  const contentType = resp.headers.get('content-type') ?? '';
  if (contentType.startsWith('application/json')) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      return (
        (body.error_message as string | undefined)
        ?? (body.detail as string | undefined)
        ?? (body.error as string | undefined)
        ?? (body.message as string | undefined)
        ?? text.slice(0, 200)
      );
    } catch {
      // fall through to text slice
    }
  }
  return text.slice(0, 200);
}

/**
 * Register each {@link ScannedModule} as an HTTP proxy module in the
 * provided registry. Each registered module's `execute()` forwards its
 * inputs to the configured `baseUrl` and maps the response back to the
 * module's output schema.
 */
export class HTTPProxyRegistryWriter {
  private readonly baseUrl: string;
  private readonly authHeaderFactory?: () => Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HTTPProxyRegistryWriterOptions) {
    this.baseUrl = options.baseUrl;
    this.authHeaderFactory = options.authHeaderFactory;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    const f = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) {
      throw new Error(
        'HTTPProxyRegistryWriter: global fetch is unavailable — pass `fetchImpl` explicitly or run on Node 20+.',
      );
    }
    this.fetchImpl = f;
  }

  /**
   * Register each module's HTTP proxy into the registry.
   *
   * Returns one {@link WriteResult} per module. A module that fails to
   * build is reported with `verified: false` rather than throwing, so
   * one bad module does not abort the batch.
   */
  async write(modules: ScannedModule[], registry: ProxyRegistry): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    for (const mod of modules) {
      try {
        const fm = this.buildFunctionModule(mod);
        registry.register(mod.moduleId, fm);
        results.push(createWriteResult(mod.moduleId, null, true));
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        results.push(createWriteResult(mod.moduleId, null, false, msg));
      }
    }
    return results;
  }

  private buildFunctionModule(mod: ScannedModule): FunctionModule {
    const { httpMethod, urlPath } = getHttpFields(mod);
    const pathParams = extractPathParamNames(urlPath);
    const baseUrl = this.baseUrl;
    const authFactory = this.authHeaderFactory;
    const timeoutMs = this.timeoutMs;
    const fetchImpl = this.fetchImpl;

    const execute = async (
      inputs: Record<string, unknown>,
      _ctx: Context,
    ): Promise<Record<string, unknown>> => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (authFactory) {
        const authHeaders = authFactory();
        if (authHeaders && typeof authHeaders === 'object') {
          Object.assign(headers, authHeaders);
        } else {
          throw new TypeError(
            `authHeaderFactory must return an object of headers, got ${typeof authHeaders}`,
          );
        }
      }

      // Split inputs into path-params and remaining; substitute path placeholders.
      const pathValues: Record<string, unknown> = {};
      const nonPath: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inputs)) {
        if (pathParams.has(k)) pathValues[k] = v;
        else nonPath[k] = v;
      }
      const actualPath = substitutePathParams(urlPath, pathValues);
      let fullUrl = joinUrl(baseUrl, actualPath);

      let body: string | undefined;
      const methodUpper = httpMethod.toUpperCase();
      if (Object.keys(nonPath).length > 0) {
        if (BODY_METHODS.has(methodUpper)) {
          body = JSON.stringify(nonPath);
        } else {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(nonPath)) {
            if (v === undefined || v === null) continue;
            if (typeof v === 'object') {
              // Non-body HTTP methods cannot carry nested JSON — log and str-serialize
              // to match Python's behaviour rather than silently drop.
              params.append(k, JSON.stringify(v));
            } else {
              params.append(k, String(v));
            }
          }
          const sep = fullUrl.includes('?') ? '&' : '?';
          fullUrl = `${fullUrl}${sep}${params.toString()}`;
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let resp: Response;
      try {
        resp = await fetchImpl(fullUrl, {
          method: methodUpper,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (exc) {
        clearTimeout(timer);
        const msg = exc instanceof Error ? exc.message : String(exc);
        throw new ModuleError(
          ErrorCodes.MODULE_EXECUTE_ERROR,
          `HTTP transport error: ${msg}`,
          {},
        );
      }
      clearTimeout(timer);

      const text = await resp.text();
      if (resp.status >= 200 && resp.status < 300) {
        if (resp.status === 204 || text === '') return {};
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (exc) {
          throw new ModuleError(
            ErrorCodes.MODULE_EXECUTE_ERROR,
            `HTTP ${resp.status}: invalid JSON in response body`,
            { http_status: resp.status },
          );
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new ModuleError(
            ErrorCodes.MODULE_EXECUTE_ERROR,
            `HTTP ${resp.status}: expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
            { http_status: resp.status },
          );
        }
        return parsed as Record<string, unknown>;
      }

      const errorMsg = extractErrorMessage(resp, text);
      throw new ModuleError(
        ErrorCodes.MODULE_EXECUTE_ERROR,
        `HTTP ${resp.status}: ${errorMsg}`,
        { http_status: resp.status },
      );
    };

    return new FunctionModule({
      execute,
      moduleId: mod.moduleId,
      inputSchema: jsonSchemaToTypeBox(mod.inputSchema),
      outputSchema: jsonSchemaToTypeBox(mod.outputSchema),
      description: mod.description,
      documentation: mod.documentation,
      tags: mod.tags.length > 0 ? [...mod.tags] : null,
      version: mod.version,
      annotations: mod.annotations,
      metadata: Object.keys(mod.metadata).length > 0 ? { ...mod.metadata } : null,
      examples: mod.examples.length > 0 ? ([...mod.examples] as ModuleExample[]) : null,
    });
  }
}
