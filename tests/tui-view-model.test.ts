// Hand-written regression tests for tui-view-model.ts, complementing the
// shared-fixture conformance suite in view-model-conformance.test.ts. These
// cover behavior that is correct-by-construction in the frozen conformance
// corpus but was found to diverge from Python/Rust during a cross-SDK audit.

import { describe, it, expect } from 'vitest';
import { createAnnotations } from 'apcore-js';

import { createScannedModule } from '../src/types.js';
import { modulesToViewModel } from '../src/tui-view-model.js';
import type { Filter } from '../src/tui-view-model.js';

describe('Filter.annotations — snake_case flag name lookup', () => {
  it('includes a module whose requiresApproval annotation is true when filtered by "requires_approval"', () => {
    const module = createScannedModule({
      moduleId: 'a.one',
      description: 'A one',
      inputSchema: {},
      outputSchema: {},
      tags: [],
      target: 'x',
      annotations: createAnnotations({ requiresApproval: true }),
    });

    const filter: Filter = {
      tags: [],
      search: '',
      annotations: ['requires_approval'],
      exposure: 'all',
      deprecated: true,
    };

    const vm = modulesToViewModel([module], {
      view: 'list',
      columns: ['module_id'],
      filter,
    });

    expect(vm.rows).toHaveLength(1);
  });

  it('excludes a module whose openWorld annotation is false when filtered by "open_world"', () => {
    const module = createScannedModule({
      moduleId: 'a.one',
      description: 'A one',
      inputSchema: {},
      outputSchema: {},
      tags: [],
      target: 'x',
      annotations: createAnnotations({ openWorld: false }),
    });

    const filter: Filter = {
      tags: [],
      search: '',
      annotations: ['open_world'],
      exposure: 'all',
      deprecated: true,
    };

    const vm = modulesToViewModel([module], {
      view: 'list',
      columns: ['module_id'],
      filter,
    });

    expect(vm.rows).toHaveLength(0);
  });

  it('still excludes a module with no annotations at all', () => {
    const module = createScannedModule({
      moduleId: 'a.one',
      description: 'A one',
      inputSchema: {},
      outputSchema: {},
      tags: [],
      target: 'x',
      annotations: null,
    });

    const filter: Filter = {
      tags: [],
      search: '',
      annotations: ['requires_approval'],
      exposure: 'all',
      deprecated: true,
    };

    const vm = modulesToViewModel([module], {
      view: 'list',
      columns: ['module_id'],
      filter,
    });

    expect(vm.rows).toHaveLength(0);
  });
});

describe('Filter.annotations — restricted to the 9 canonical boolean flags', () => {
  it('excludes a module filtered by the non-boolean "extra" field even though it is present and truthy', () => {
    // `extra` is always a (possibly empty) dict, so a naive
    // `annotationsRecord[fieldName]` truthy check on it always passes,
    // regardless of the caller's intent — it must never be a recognized
    // filter name.
    const module = createScannedModule({
      moduleId: 'a.one',
      description: 'A one',
      inputSchema: {},
      outputSchema: {},
      tags: [],
      target: 'x',
      annotations: createAnnotations({ extra: { note: 'anything' } }),
    });

    const filter: Filter = {
      tags: [],
      search: '',
      annotations: ['extra'],
      exposure: 'all',
      deprecated: true,
    };

    const vm = modulesToViewModel([module], {
      view: 'list',
      columns: ['module_id'],
      filter,
    });

    expect(vm.rows).toHaveLength(0);
  });

  it('excludes a module filtered by the non-boolean multi-word "pagination_style" field', () => {
    const module = createScannedModule({
      moduleId: 'a.one',
      description: 'A one',
      inputSchema: {},
      outputSchema: {},
      tags: [],
      target: 'x',
      annotations: createAnnotations({ paginationStyle: 'cursor' }),
    });

    const filter: Filter = {
      tags: [],
      search: '',
      annotations: ['pagination_style'],
      exposure: 'all',
      deprecated: true,
    };

    const vm = modulesToViewModel([module], {
      view: 'list',
      columns: ['module_id'],
      filter,
    });

    expect(vm.rows).toHaveLength(0);
  });

  it.each([
    ['readonly', { readonly: true }],
    ['destructive', { destructive: true }],
    ['idempotent', { idempotent: true }],
    ['requires_approval', { requiresApproval: true }],
    ['open_world', { openWorld: true }],
    ['streaming', { streaming: true }],
    ['cacheable', { cacheable: true }],
    ['paginated', { paginated: true }],
    ['discoverable', { discoverable: true }],
  ] as const)(
    'still includes a module when the canonical boolean flag "%s" is true and filtered by that name',
    (name, override) => {
      const module = createScannedModule({
        moduleId: 'a.one',
        description: 'A one',
        inputSchema: {},
        outputSchema: {},
        tags: [],
        target: 'x',
        annotations: createAnnotations(override),
      });

      const filter: Filter = {
        tags: [],
        search: '',
        annotations: [name],
        exposure: 'all',
        deprecated: true,
      };

      const vm = modulesToViewModel([module], {
        view: 'list',
        columns: ['module_id'],
        filter,
      });

      expect(vm.rows).toHaveLength(1);
    },
  );
});
