import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCANNER_VERB_MAP,
  extractPathParamNames,
  generateSuggestedAlias,
  hasPathParams,
  resolveHttpVerb,
  substitutePathParams,
} from '../src/http-verb-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'scanner_verb_map.json');

interface ConformanceCase {
  id: string;
  path: string;
  method: string;
  expected_alias: string;
  description: string;
}

function loadFixture(): ConformanceCase[] {
  const content = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  return JSON.parse(content) as ConformanceCase[];
}

describe('http-verb-map public API re-exports', () => {
  it('imports SCANNER_VERB_MAP from package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(pkg.SCANNER_VERB_MAP['POST']).toBe('create');
  });

  it('imports resolveHttpVerb from package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(pkg.resolveHttpVerb('POST', false)).toBe('create');
  });

  it('imports hasPathParams from package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(pkg.hasPathParams('/tasks/{id}')).toBe(true);
  });

  it('imports generateSuggestedAlias from package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(pkg.generateSuggestedAlias('/tasks', 'POST')).toBe('tasks.create');
  });

  it('imports extractPathParamNames from package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(pkg.extractPathParamNames('/users/{id}')).toEqual(new Set(['id']));
  });

  it('imports substitutePathParams from package entry', async () => {
    const pkg = await import('../src/index.js');
    expect(pkg.substitutePathParams('/users/{id}', { id: 42 })).toBe('/users/42');
  });
});

describe('extractPathParamNames', () => {
  it('returns empty set for static path', () => {
    expect(extractPathParamNames('/tasks')).toEqual(new Set<string>());
  });
  it('extracts brace-style names', () => {
    expect(extractPathParamNames('/users/{id}')).toEqual(new Set(['id']));
  });
  it('extracts colon-style names', () => {
    expect(extractPathParamNames('/users/:id')).toEqual(new Set(['id']));
  });
  it('extracts multiple mixed-style names', () => {
    expect(extractPathParamNames('/orgs/{org_id}/members/:member_id')).toEqual(
      new Set(['org_id', 'member_id']),
    );
  });
  it('deduplicates repeated names', () => {
    expect(extractPathParamNames('/a/{id}/b/{id}')).toEqual(new Set(['id']));
  });
  it('ignores non-string input', () => {
    expect(extractPathParamNames(undefined as unknown as string)).toEqual(new Set<string>());
  });
});

describe('substitutePathParams', () => {
  it('substitutes brace-style values', () => {
    expect(substitutePathParams('/users/{id}', { id: 42 })).toBe('/users/42');
  });
  it('substitutes colon-style values', () => {
    expect(substitutePathParams('/users/:id', { id: 'abc' })).toBe('/users/abc');
  });
  it('leaves unknown placeholders untouched', () => {
    expect(substitutePathParams('/users/{id}/{role}', { id: 1 })).toBe('/users/1/{role}');
  });
  it('ignores extra keys', () => {
    expect(substitutePathParams('/users/{id}', { id: 1, extra: 'x' })).toBe('/users/1');
  });
  it('returns original path if no placeholders', () => {
    expect(substitutePathParams('/tasks', { id: 1 })).toBe('/tasks');
  });
  it('handles multiple placeholders of both styles', () => {
    expect(substitutePathParams('/orgs/{org_id}/members/:m', { org_id: 7, m: 'me' })).toBe(
      '/orgs/7/members/me',
    );
  });
});

describe('hasPathParams', () => {
  it('returns false for empty string', () => {
    expect(hasPathParams('')).toBe(false);
  });
  it('returns false for root path', () => {
    expect(hasPathParams('/')).toBe(false);
  });
  it('returns false for static path', () => {
    expect(hasPathParams('/tasks')).toBe(false);
  });
  it('detects brace style', () => {
    expect(hasPathParams('/tasks/{id}')).toBe(true);
  });
  it('detects colon style', () => {
    expect(hasPathParams('/tasks/:id')).toBe(true);
  });
  it('detects mixed styles', () => {
    expect(hasPathParams('/{id}/:name')).toBe(true);
  });
  it('returns false for multi-segment static', () => {
    expect(hasPathParams('/a/b/c')).toBe(false);
  });
  it('returns false for empty brace', () => {
    expect(hasPathParams('/tasks/{}')).toBe(false);
  });
});

describe('resolveHttpVerb', () => {
  it('GET collection -> list', () => {
    expect(resolveHttpVerb('GET', false)).toBe('list');
  });
  it('GET single -> get', () => {
    expect(resolveHttpVerb('GET', true)).toBe('get');
  });
  it('GET case insensitive', () => {
    expect(resolveHttpVerb('get', false)).toBe('list');
  });
  it('POST no params -> create', () => {
    expect(resolveHttpVerb('POST', false)).toBe('create');
  });
  it('POST with params -> create', () => {
    expect(resolveHttpVerb('POST', true)).toBe('create');
  });
  it('PUT -> update', () => {
    expect(resolveHttpVerb('PUT', true)).toBe('update');
  });
  it('PATCH -> patch', () => {
    expect(resolveHttpVerb('PATCH', true)).toBe('patch');
  });
  it('DELETE -> delete', () => {
    expect(resolveHttpVerb('DELETE', true)).toBe('delete');
  });
  it('HEAD -> head', () => {
    expect(resolveHttpVerb('HEAD', false)).toBe('head');
  });
  it('OPTIONS -> options', () => {
    expect(resolveHttpVerb('OPTIONS', false)).toBe('options');
  });
  it('unknown method -> lowercase fallback', () => {
    expect(resolveHttpVerb('PURGE', false)).toBe('purge');
  });
  it('empty method -> empty', () => {
    expect(resolveHttpVerb('', false)).toBe('');
  });
});

describe('generateSuggestedAlias', () => {
  it('POST collection', () => {
    expect(generateSuggestedAlias('/tasks/user_data', 'POST')).toBe('tasks.user_data.create');
  });
  it('GET collection', () => {
    expect(generateSuggestedAlias('/tasks/user_data', 'GET')).toBe('tasks.user_data.list');
  });
  it('GET single', () => {
    expect(generateSuggestedAlias('/tasks/user_data/{id}', 'GET')).toBe('tasks.user_data.get');
  });
  it('PUT single', () => {
    expect(generateSuggestedAlias('/tasks/user_data/{id}', 'PUT')).toBe('tasks.user_data.update');
  });
  it('PATCH single', () => {
    expect(generateSuggestedAlias('/tasks/user_data/{id}', 'PATCH')).toBe('tasks.user_data.patch');
  });
  it('DELETE single', () => {
    expect(generateSuggestedAlias('/tasks/user_data/{id}', 'DELETE')).toBe(
      'tasks.user_data.delete',
    );
  });
  it('single segment', () => {
    expect(generateSuggestedAlias('/health', 'GET')).toBe('health.list');
  });
  it('root path', () => {
    expect(generateSuggestedAlias('/', 'GET')).toBe('list');
  });
  it('empty path', () => {
    expect(generateSuggestedAlias('', 'GET')).toBe('list');
  });
  it('colon param', () => {
    expect(generateSuggestedAlias('/users/:user_id', 'GET')).toBe('users.get');
  });
  it('version prefix', () => {
    expect(generateSuggestedAlias('/api/v2/users', 'GET')).toBe('api.v2.users.list');
  });
  it('nested params stripped for collection', () => {
    expect(generateSuggestedAlias('/orgs/{org_id}/teams/{team_id}/members', 'GET')).toBe(
      'orgs.teams.members.list',
    );
  });
  it('double slashes collapsed', () => {
    expect(generateSuggestedAlias('//tasks//user_data//', 'POST')).toBe('tasks.user_data.create');
  });
  it('param only path', () => {
    expect(generateSuggestedAlias('/{id}', 'GET')).toBe('get');
  });
});

describe('SCANNER_VERB_MAP constant', () => {
  it('contains standard HTTP methods', () => {
    const keys = new Set(Object.keys(SCANNER_VERB_MAP));
    for (const k of ['GET', 'GET_ID', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(keys.has(k)).toBe(true);
    }
  });
  it('values are lowercase', () => {
    for (const v of Object.values(SCANNER_VERB_MAP)) {
      expect(v).toBe(v.toLowerCase());
    }
  });
});

describe('conformance fixture', () => {
  const cases = loadFixture();
  it.each(cases)('$method $path -> $expected_alias', (c) => {
    const result = generateSuggestedAlias(c.path, c.method);
    expect(result).toBe(c.expected_alias);
  });
});

// resolveHttpVerb GET fallback regression (D4-get-fallback)
describe('resolveHttpVerb — GET branch fallback', () => {
  it('returns "list" for GET without path params', () => {
    expect(resolveHttpVerb('GET', false)).toBe('list');
  });

  it('returns "get" for GET with path params', () => {
    expect(resolveHttpVerb('GET', true)).toBe('get');
  });

  it('falls back to lowercase method for unknown verbs', () => {
    expect(resolveHttpVerb('CONNECT', false)).toBe('connect');
    expect(resolveHttpVerb('TRACE', false)).toBe('trace');
  });

  // W10 regression: non-string method must not crash via .toUpperCase()
  it('returns "unknown" for non-string method (W10)', () => {
    expect(resolveHttpVerb(null as unknown as string, false)).toBe('unknown');
    expect(resolveHttpVerb(undefined as unknown as string, false)).toBe('unknown');
    expect(resolveHttpVerb(42 as unknown as string, false)).toBe('unknown');
  });
});

// W11 regression: non-string path/method must not crash via .replace()
describe('generateSuggestedAlias — non-string input guards (W11)', () => {
  it('returns "unknown" for non-string path', () => {
    expect(generateSuggestedAlias(null as unknown as string, 'GET')).toBe('unknown');
  });

  it('returns "unknown" for non-string method', () => {
    expect(generateSuggestedAlias('/tasks', null as unknown as string)).toBe('unknown');
  });
});
