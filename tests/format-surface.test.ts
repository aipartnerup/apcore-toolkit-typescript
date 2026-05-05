import { describe, it, expect } from 'vitest';
import { DEFAULT_ANNOTATIONS } from 'apcore-js';

import {
  createScannedModule,
  formatSchema,
  formatModule,
  formatModules,
  type ScannedModule,
} from '../src/index.js';

function fixtureModule(overrides: Partial<Parameters<typeof createScannedModule>[0]> = {}): ScannedModule {
  return createScannedModule({
    moduleId: 'users.get_user',
    description: 'Look up a user by id',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'User id' },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
    },
    tags: ['users'],
    target: 'myapp.views:get_user',
    annotations: { ...DEFAULT_ANNOTATIONS, readonly: true, cacheable: true },
    ...overrides,
  });
}

describe('formatSchema', () => {
  it('prose marks required vs optional', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'User id' },
        verbose: { type: 'boolean' },
      },
      required: ['id'],
    };
    const out = formatSchema(schema, { style: 'prose' }) as string;
    expect(out).toContain('`id` (integer, required) — User id');
    expect(out).toContain('`verbose` (boolean, optional)');
  });

  it('table emits correct header and a yes/no required column', () => {
    const schema = {
      type: 'object',
      properties: { id: { type: 'integer', description: 'User id' } },
      required: ['id'],
    };
    const out = formatSchema(schema, { style: 'table' }) as string;
    expect(out).toContain('| Name | Type | Required | Default | Description |');
    expect(out).toContain('| `id` | integer | yes |  | User id |');
  });

  it('json passthrough returns the input', () => {
    const schema = { type: 'object', properties: { id: { type: 'integer' } } };
    const out = formatSchema(schema, { style: 'json' });
    expect(out).toBe(schema);
  });

  it('rejects unknown style', () => {
    expect(() => formatSchema({}, { style: 'bogus' as never })).toThrow(/unknown style/);
  });

  it('collapses nested object beyond max_depth into a JSON code block', () => {
    const schema = {
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: {
              type: 'object',
              properties: { deep: { type: 'string' } },
            },
          },
        },
      },
    };
    const out = formatSchema(schema, { style: 'prose', maxDepth: 2 }) as string;
    expect(out).toContain('```json');
  });

  it('non-object schema renders summary', () => {
    expect(formatSchema({ type: 'string' }, { style: 'prose' })).toContain('string');
  });

  it('empty schema prose returns empty string', () => {
    expect(formatSchema({}, { style: 'prose' })).toBe('');
  });
});

describe('formatModule markdown', () => {
  it('emits title, description, parameters and returns sections', () => {
    const out = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    expect(out.startsWith('# users.get_user')).toBe(true);
    expect(out).toContain('Look up a user by id');
    expect(out).toContain('## Parameters');
    expect(out).toContain('## Returns');
    expect(out).toContain('`id` (integer, required) — User id');
  });

  it('renders annotations as a fact table under Behavior', () => {
    const out = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    expect(out).toContain('## Behavior');
    expect(out).toContain('| Flag | Value |');
    expect(out).toContain('`readonly`');
    expect(out).toContain('`cacheable`');
    // destructive=false matches the default; must not appear.
    expect(out).not.toContain('`destructive`');
  });

  it('annotation bools render as lowercase', () => {
    const out = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    expect(out).toContain('| `readonly` | true |');
    expect(out).toContain('| `cacheable` | true |');
    expect(out).not.toContain('| `readonly` | True |');
  });

  it('annotation rows are alphabetically sorted', () => {
    const out = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    const readonlyIdx = out.indexOf('`readonly`');
    const cacheableIdx = out.indexOf('`cacheable`');
    // 'cacheable' < 'readonly' alphabetically
    expect(cacheableIdx).toBeLessThan(readonlyIdx);
  });

  it('skips fields equal to ModuleAnnotations defaults', () => {
    const out = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    // pagination_style defaults to "cursor"; must not appear.
    expect(out).not.toContain('`pagination_style`');
  });

  it('omits Behavior section when every annotation field equals its default', () => {
    const module = fixtureModule({ annotations: { ...DEFAULT_ANNOTATIONS } });
    const out = formatModule(module, { style: 'markdown' }) as string;
    expect(out).not.toContain('## Behavior');
  });

  it('omits Behavior section when annotations is null', () => {
    const module = fixtureModule({ annotations: null });
    const out = formatModule(module, { style: 'markdown' }) as string;
    expect(out).not.toContain('## Behavior');
  });

  it('emits Examples block when examples present', () => {
    const module = fixtureModule({
      examples: [{ title: 'lookup', inputs: { id: 1 }, output: { name: 'Ada' } } as never],
    });
    const out = formatModule(module, { style: 'markdown' }) as string;
    expect(out).toContain('## Examples');
    expect(out).toContain('Ada');
  });

  it('emits Tags section', () => {
    const out = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    expect(out).toContain('## Tags');
    expect(out).toContain('`users`');
  });
});

describe('formatModule skill', () => {
  it('emits minimal frontmatter (name + description only)', () => {
    const out = formatModule(fixtureModule(), { style: 'skill' }) as string;
    expect(out.startsWith('---\n')).toBe(true);
    const [head] = out.split('\n---\n');
    expect(head).toContain('name: users.get_user');
    expect(head).toContain('description: ');
    for (const forbidden of ['allowed-tools', 'paths', 'when_to_use', 'user-invocable']) {
      expect(out).not.toContain(forbidden);
    }
  });

  it('skill body is byte-identical to markdown body', () => {
    const skill = formatModule(fixtureModule(), { style: 'skill' }) as string;
    const markdown = formatModule(fixtureModule(), { style: 'markdown' }) as string;
    const body = skill.split('\n---\n', 2)[1].replace(/^\n+/, '');
    expect(body).toBe(markdown);
  });

  it('quotes a description containing a colon', () => {
    const module = fixtureModule({ description: 'Get: by id' });
    const out = formatModule(module, { style: 'skill' }) as string;
    expect(out).toContain('description: "Get: by id"');
  });
});

describe('formatModule table-row and json', () => {
  it('table-row produces a pipe-separated single line', () => {
    const out = formatModule(fixtureModule(), { style: 'table-row' }) as string;
    expect(out).toContain('`users.get_user`');
    expect(out).toContain('Look up a user by id');
    expect(out).toContain('users');
  });

  it('json returns a serializable dict', () => {
    const out = formatModule(fixtureModule(), { style: 'json' }) as Record<string, unknown>;
    expect(out['module_id']).toBe('users.get_user');
    expect(out['description']).toBe('Look up a user by id');
  });
});

describe('display overlay', () => {
  it('display=true uses overlay alias / description / tags', () => {
    const module = fixtureModule({
      display: {
        alias: 'lookup-user',
        description: 'Quickly look someone up.',
        tags: ['accounts'],
      },
    });
    const out = formatModule(module, { style: 'markdown', display: true }) as string;
    expect(out).toContain('# lookup-user');
    expect(out).toContain('Quickly look someone up.');
    expect(out).toContain('`accounts`');
  });

  it('display=false ignores overlay and uses raw fields', () => {
    const module = fixtureModule({
      display: { alias: 'lookup-user', description: 'ignored' },
    });
    const out = formatModule(module, { style: 'markdown', display: false }) as string;
    expect(out).toContain('# users.get_user');
    expect(out).toContain('Look up a user by id');
    expect(out).not.toContain('lookup-user');
  });
});

describe('formatModule errors', () => {
  it('throws on unknown style', () => {
    expect(() => formatModule(fixtureModule(), { style: 'bogus' as never })).toThrow(/unknown style/);
  });
});

describe('formatModules', () => {
  it('ungrouped concatenates all modules', () => {
    const modules = [
      fixtureModule(),
      fixtureModule({ moduleId: 'users.create_user', description: 'Create a user', tags: ['users'] }),
    ];
    const out = formatModules(modules, { style: 'markdown' }) as string;
    expect(out).toContain('users.get_user');
    expect(out).toContain('users.create_user');
  });

  it('group_by="tag" creates one section per tag', () => {
    const modules = [
      fixtureModule(),
      fixtureModule({ moduleId: 'tasks.list', description: 'List tasks', tags: ['tasks'] }),
    ];
    const out = formatModules(modules, { style: 'markdown', groupBy: 'tag' }) as string;
    expect(out).toContain('## users');
    expect(out).toContain('## tasks');
  });

  it('group_by="prefix" splits on first dot', () => {
    const modules = [
      fixtureModule(),
      fixtureModule({ moduleId: 'tasks.list', description: 'List tasks', tags: [] }),
    ];
    const out = formatModules(modules, { style: 'markdown', groupBy: 'prefix' }) as string;
    expect(out).toContain('## users');
    expect(out).toContain('## tasks');
  });

  it('json returns an array of dicts', () => {
    const out = formatModules([fixtureModule()], { style: 'json' }) as Record<string, unknown>[];
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]['module_id']).toBe('users.get_user');
  });

  it('rejects unknown group_by', () => {
    expect(() =>
      formatModules([fixtureModule()], { style: 'markdown', groupBy: 'bogus' as never }),
    ).toThrow(/unknown groupBy/);
  });

  it('untagged modules go into "(untagged)" bucket when group_by="tag"', () => {
    const modules = [fixtureModule({ tags: [] })];
    const out = formatModules(modules, { style: 'markdown', groupBy: 'tag' }) as string;
    expect(out).toContain('## (untagged)');
  });
});
