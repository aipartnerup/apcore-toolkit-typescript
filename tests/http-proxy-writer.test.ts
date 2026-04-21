import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from 'apcore-js';
import type { Context } from 'apcore-js';

import {
  HTTPProxyRegistryWriter,
  HTTPProxyWriterError,
} from '../src/output/http-proxy-writer.js';
import type { ScannedModule } from '../src/types.js';
import { createScannedModule } from '../src/types.js';

function mkModule(overrides: Partial<ScannedModule> = {}): ScannedModule {
  return {
    ...createScannedModule({
      moduleId: 'tasks.create',
      description: 'create task',
      target: 'my_app.handlers.tasks:create_task',
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      outputSchema: { type: 'object', properties: {}, additionalProperties: true },
      tags: [],
      metadata: { httpMethod: 'POST', urlPath: '/tasks' },
    }),
    ...overrides,
  };
}

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
};

function recordingFetch(
  responder: (call: FetchCall) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders) {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k] = v;
      }
    }
    const call: FetchCall = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return responder(call);
  };
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Executable {
  execute(inputs: Record<string, unknown>, ctx: Context): Promise<Record<string, unknown>>;
}

function getRegistered(registry: Registry, id: string): Executable {
  const mod = registry.get(id);
  if (!mod) throw new Error(`module ${id} not registered`);
  return mod as unknown as Executable;
}

describe('HTTPProxyRegistryWriter', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  it('registers each module with WriteResult verified=true', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse(200, { ok: true }));
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      fetchImpl,
    });
    const results = await writer.write([mkModule()], registry);
    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(true);
    expect(results[0].moduleId).toBe('tasks.create');
  });

  it('POSTs non-path inputs as JSON body to the resolved URL', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, { id: 1 }));
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      fetchImpl,
    });
    await writer.write([mkModule()], registry);
    const mod = getRegistered(registry, 'tasks.create');
    const result = await mod.execute({ title: 'a' }, {} as Context);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('http://localhost:8000/tasks');
    expect(calls[0].body).toBe(JSON.stringify({ title: 'a' }));
    expect(result).toEqual({ id: 1 });
  });

  it('substitutes brace path params and puts remaining inputs in the body', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, { ok: true }));
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      fetchImpl,
    });
    await writer.write(
      [
        mkModule({
          moduleId: 'tasks.update',
          metadata: { httpMethod: 'PUT', urlPath: '/tasks/{id}' },
        }),
      ],
      registry,
    );
    const mod = getRegistered(registry, 'tasks.update');
    await mod.execute({ id: 42, title: 'b' }, {} as Context);
    expect(calls[0].url).toBe('http://localhost:8000/tasks/42');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toBe(JSON.stringify({ title: 'b' }));
  });

  it('puts non-path inputs into the query string for GET', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, { list: [] }));
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      fetchImpl,
    });
    await writer.write(
      [
        mkModule({
          moduleId: 'tasks.list',
          metadata: { httpMethod: 'GET', urlPath: '/tasks' },
        }),
      ],
      registry,
    );
    const mod = getRegistered(registry, 'tasks.list');
    await mod.execute({ status: 'open', limit: 10 }, {} as Context);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/^http:\/\/localhost:8000\/tasks\?/);
    expect(calls[0].url).toContain('status=open');
    expect(calls[0].url).toContain('limit=10');
    expect(calls[0].body).toBeUndefined();
  });

  it('applies authHeaderFactory on each call', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, { ok: true }));
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      authHeaderFactory: () => ({ Authorization: 'Bearer xxx' }),
      fetchImpl,
    });
    await writer.write([mkModule()], registry);
    await getRegistered(registry, 'tasks.create').execute({}, {} as Context);
    expect(calls[0].headers['Authorization']).toBe('Bearer xxx');
  });

  it('raises on 4xx with the extracted error message', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse(400, { error_message: 'invalid input' }),
    );
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      fetchImpl,
    });
    await writer.write([mkModule()], registry);
    await expect(
      getRegistered(registry, 'tasks.create').execute({}, {} as Context),
    ).rejects.toThrow(/HTTP 400: invalid input/);
  });

  it('reports verified=false when url_path is an absolute URL', async () => {
    const writer = new HTTPProxyRegistryWriter({
      baseUrl: 'http://localhost:8000',
      fetchImpl: recordingFetch(() => jsonResponse(200, {})).fetchImpl,
    });
    const results = await writer.write(
      [
        mkModule({
          moduleId: 'tasks.bad',
          metadata: { httpMethod: 'POST', urlPath: 'http://evil/tasks' },
        }),
      ],
      registry,
    );
    expect(results[0].verified).toBe(false);
    expect(results[0].verificationError ?? '').toContain('HTTPProxyWriterError');
  });

  it('exposes HTTPProxyWriterError as a named class', () => {
    expect(new HTTPProxyWriterError('m', 'x').name).toBe('HTTPProxyWriterError');
  });

  it('can be imported from the package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(typeof pkg.HTTPProxyRegistryWriter).toBe('function');
    expect(typeof pkg.HTTPProxyWriterError).toBe('function');
  });
});
