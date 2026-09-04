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
