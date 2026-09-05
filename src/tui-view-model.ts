/**
 * TuiViewModel — Tier-1 byte-equivalent module-list view shape.
 *
 * Lifts the *shape* of a module-list view (columns, rows, filter intent,
 * sort intent, color-by-tag rules) into the toolkit, so every downstream
 * consumer (`apcore-cli-*`, future browser dashboards, MCP/A2A surfaces)
 * produces identical column sets, identical filter semantics, and identical
 * row order for the same `ScannedModule` input. Rendering itself stays
 * Tier 2 and is free to differ in pixels.
 *
 * Pure, synchronous, no Node.js dependency — also re-exported from
 * `apcore-toolkit/browser`.
 *
 * See `apcore-toolkit/docs/features/tui-view-model.md` for the full V1
 * specification, wire format, and conformance corpus.
 */

import type { ScannedModule } from './types.js';

export type View = 'list' | 'grouped';
export type Justify = 'left' | 'right' | 'center';
export type Exposure = 'exposed' | 'hidden' | 'all';
export type Direction = 'asc' | 'desc';
export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info';
export type CellKind = 'text' | 'tags' | 'badge' | 'symbol';
export type GroupBy = 'tag' | 'prefix';

const SORTABLE_KEYS: ReadonlySet<string> = new Set(['module_id', 'alias', 'description']);

// No built-in default column set: `columns` must be explicitly requested by
// the caller. An empty `columns` array yields an empty `columns` array (see
// conformance fixture `view_model_001_empty_list`) — callers wanting the
// conventional ID/description/tags layout pass it explicitly, e.g.
// `columns: ["module_id", "description", "tags"]`.
const COLUMN_LABELS: Readonly<Record<string, string>> = {
  module_id: 'ID',
  alias: 'Alias',
  description: 'Description',
  tags: 'Tags',
};

// `Filter.annotations` names are the spec's snake_case `ModuleAnnotations`
// flag names (matching Python's `getattr`/Rust's explicit match, both
// snake_case), but the installed `apcore-js` package's `ModuleAnnotations`
// interface uses camelCase field names. Multi-word flags need translation
// or the lookup silently misses (a bare `annotationsRecord[snakeCaseName]`
// is always `undefined` for `requires_approval`/`open_world`, excluding
// every module regardless of the flag's real value). Single-word flags are
// identical either way and don't need an entry.
const ANNOTATION_FIELD_ALIASES: Readonly<Record<string, string>> = {
  requires_approval: 'requiresApproval',
  open_world: 'openWorld',
};

// `Filter.annotations` recognizes exactly the 9 canonical boolean
// `ModuleAnnotations` flags (matching Rust's hardcoded 9-way match and
// Python's explicit frozenset) — never the non-boolean `cacheTtl` /
// `cacheKeyFields` / `paginationStyle` / `extra` fields. Those would
// otherwise either silently miss (multi-word names not in the alias map
// above, evaluated against the wrong un-aliased key) or, worse, accidentally
// "work" via a truthy-object check (`extra` is a dict, always present and
// therefore always truthy) that never reflects the caller's intent. An
// unrecognized name excludes every module, exactly as if the flag were
// `false`.
const FILTERABLE_ANNOTATION_FLAGS: ReadonlySet<string> = new Set([
  'readonly',
  'destructive',
  'idempotent',
  'requires_approval',
  'open_world',
  'streaming',
  'cacheable',
  'paginated',
  'discoverable',
]);

/** A single table cell (discriminated union by `kind`). */
export interface Cell {
  kind: CellKind;
  /** Present for `"text"` / `"badge"` / `"symbol"` kinds. */
  value?: string;
  /** Present for the `"tags"` kind. */
  values?: string[];
  /** Optional for `"badge"` / `"symbol"` kinds. Never set by `modulesToViewModel` in V1. */
  tone?: Tone;
}

/** A view-model column: render order and `Row.cells` index lookup. */
export interface Column {
  key: string;
  label: string;
  /** Default `"left"`; omitted from the wire format when left at the default. */
  justify?: Justify;
  /** References a `TonePalette.name`. `null`/absent when no tone applies. */
  toneBy?: string | null;
}

/** A view-model row. `cells[i]` corresponds to `columns[i]`. */
export interface Row {
  cells: Cell[];
  /** Used by `tone_by` palette `tag_equals` rules. Omitted from the wire format when empty. */
  tags?: string[];
}

/** Annotates which sort the toolkit (or the caller) applied. */
export interface Sort {
  key: string;
  /** Default `"asc"`. */
  direction?: Direction;
}

/** Annotates which filter the toolkit applied. All fields required in the wire format. */
export interface Filter {
  tags: string[];
  search: string;
  annotations: string[];
  exposure: Exposure;
  deprecated: boolean;
}

/** First-match-wins rule mapping a tag to a semantic tone. */
export interface ToneRule {
  value: string;
  tone: Tone;
  /** Only `"tag_equals"` is supported in V1; defaults to it. */
  kind?: 'tag_equals';
}

/** A named, ordered set of {@link ToneRule}. */
export interface TonePalette {
  name: string;
  rules: ToneRule[];
}

/** A named group of row indices, present only when `kind === "grouped"`. */
export interface Group {
  label: string;
  rowIndices: number[];
}

/** The V1 `TuiViewModel` wire-format envelope. */
export interface TuiViewModel {
  kind: View;
  columns: Column[];
  rows: Row[];
  schemaVersion?: number;
  title?: string | null;
  groups?: Group[] | null;
  sort?: Sort | null;
  filter?: Filter | null;
  tonePalettes?: TonePalette[] | null;
}

function cellToWire(cell: Cell): Record<string, unknown> {
  const d: Record<string, unknown> = { kind: cell.kind };
  if (cell.kind === 'tags') {
    d['values'] = cell.values ? [...cell.values] : [];
  } else {
    d['value'] = cell.value ?? '';
  }
  if (cell.tone != null) {
    d['tone'] = cell.tone;
  }
  return d;
}

function columnToWire(column: Column): Record<string, unknown> {
  const d: Record<string, unknown> = { key: column.key, label: column.label };
  if (column.justify != null && column.justify !== 'left') {
    d['justify'] = column.justify;
  }
  if (column.toneBy != null) {
    d['tone_by'] = column.toneBy;
  }
  return d;
}

function rowToWire(row: Row): Record<string, unknown> {
  const d: Record<string, unknown> = { cells: row.cells.map(cellToWire) };
  if (row.tags && row.tags.length > 0) {
    d['tags'] = [...row.tags];
  }
  return d;
}

function sortToWire(sort: Sort): Record<string, unknown> {
  return { key: sort.key, direction: sort.direction ?? 'asc' };
}

function filterToWire(filter: Filter): Record<string, unknown> {
  return {
    tags: [...filter.tags],
    search: filter.search,
    annotations: [...filter.annotations],
    exposure: filter.exposure,
    deprecated: filter.deprecated,
  };
}

function toneRuleToWire(rule: ToneRule): Record<string, unknown> {
  return { match: { kind: rule.kind ?? 'tag_equals', value: rule.value }, tone: rule.tone };
}

function tonePaletteToWire(palette: TonePalette): Record<string, unknown> {
  return { name: palette.name, rules: palette.rules.map(toneRuleToWire) };
}

function groupToWire(group: Group): Record<string, unknown> {
  return { label: group.label, row_indices: [...group.rowIndices] };
}

function toWireObject(vm: TuiViewModel): Record<string, unknown> {
  const d: Record<string, unknown> = {
    schema_version: vm.schemaVersion ?? 1,
    kind: vm.kind,
  };
  if (vm.title != null) {
    d['title'] = vm.title;
  }
  d['columns'] = vm.columns.map(columnToWire);
  d['rows'] = vm.rows.map(rowToWire);
  if (vm.groups != null) {
    d['groups'] = vm.groups.map(groupToWire);
  }
  if (vm.sort != null) {
    d['sort'] = sortToWire(vm.sort);
  }
  if (vm.filter != null) {
    d['filter'] = filterToWire(vm.filter);
  }
  if (vm.tonePalettes != null && vm.tonePalettes.length > 0) {
    d['tone_palettes'] = vm.tonePalettes.map(tonePaletteToWire);
  }
  return d;
}

/**
 * Canonical, byte-identical compact JSON encoding of `vm`.
 *
 * See `apcore-toolkit/docs/features/tui-view-model.md` § Canonical JSON
 * Encoding: declaration-order keys, optional fields omitted (never
 * `null`), lowercase booleans, no floating point, no whitespace.
 */
export function formatViewModel(vm: TuiViewModel): string {
  return JSON.stringify(toWireObject(vm));
}

function resolveAlias(module: ScannedModule, useDisplay: boolean): string {
  if (useDisplay && module.display) {
    const alias = module.display['alias'];
    if (alias) return String(alias);
  }
  return module.moduleId;
}

function resolveDescription(module: ScannedModule, useDisplay: boolean): string {
  if (useDisplay && module.display) {
    const description = module.display['description'];
    if (description) return String(description);
  }
  return module.description || '';
}

function cellFor(columnKey: string, module: ScannedModule, useDisplay: boolean): Cell {
  if (columnKey === 'module_id') return { kind: 'text', value: module.moduleId };
  if (columnKey === 'alias') return { kind: 'text', value: resolveAlias(module, useDisplay) };
  if (columnKey === 'description') return { kind: 'text', value: resolveDescription(module, useDisplay) };
  if (columnKey === 'tags') return { kind: 'tags', values: [...module.tags] };
  // Unknown/custom column key: fall back to an empty text cell rather than
  // throwing, so a caller-declared column with no toolkit-known source
  // still yields a well-formed row (renderers may post-process).
  return { kind: 'text', value: '' };
}

function passesFilter(module: ScannedModule, flt: Filter | null, description: string): boolean {
  if (flt === null) return true;

  const moduleTags = new Set(module.tags);
  if (flt.tags.length > 0 && !flt.tags.every((t) => moduleTags.has(t))) return false;

  if (flt.search) {
    const haystack = `${module.moduleId} ${description}`.toLowerCase();
    if (!haystack.includes(flt.search.toLowerCase())) return false;
  }

  const annotations = module.annotations;
  const annotationsRecord = annotations as unknown as Record<string, unknown> | null;
  for (const annotationName of flt.annotations) {
    if (!FILTERABLE_ANNOTATION_FLAGS.has(annotationName)) return false;
    const fieldName = ANNOTATION_FIELD_ALIASES[annotationName] ?? annotationName;
    if (!annotationsRecord || !annotationsRecord[fieldName]) return false;
  }

  // `discoverable` (ModuleAnnotations, default true) is the shipped signal
  // for "appears in enumeration surfaces" — hidden means not discoverable.
  const isHidden = !(annotations?.discoverable ?? true);
  if (flt.exposure === 'exposed' && isHidden) return false;
  if (flt.exposure === 'hidden' && !isHidden) return false;

  // ModuleAnnotations has no first-class `deprecated` field; the toolkit
  // convention (matching OpenAPIScanner) is `annotations.extra.deprecated`.
  const extra = (annotations?.extra ?? {}) as Record<string, unknown>;
  const isDeprecated = Boolean(extra['deprecated']);
  if (!flt.deprecated && isDeprecated) return false;

  return true;
}

function sortKeyFor(columnKey: string, module: ScannedModule, alias: string, description: string): string {
  if (columnKey === 'alias') return alias;
  if (columnKey === 'description') return description;
  return module.moduleId;
}

interface ResolvedEntry {
  module: ScannedModule;
  alias: string;
  description: string;
}

function buildGroups(resolved: ResolvedEntry[], groupBy: GroupBy | null): Group[] {
  const buckets = new Map<string, number[]>();
  const order: string[] = [];

  resolved.forEach(({ module }, idx) => {
    let labels: string[];
    if (groupBy === 'tag') {
      labels = module.tags.length > 0 ? [...module.tags] : ['(untagged)'];
    } else if (groupBy === 'prefix') {
      labels = [module.moduleId.split('.', 1)[0]];
    } else {
      labels = ['(all)'];
    }
    for (const label of labels) {
      if (!buckets.has(label)) {
        buckets.set(label, []);
        order.push(label);
      }
      buckets.get(label)!.push(idx);
    }
  });

  return order.map((label) => ({ label, rowIndices: buckets.get(label)! }));
}

/** Options for {@link modulesToViewModel}. */
export interface ModulesToViewModelOptions {
  /** Default `"list"`. */
  view?: View;
  /** Column keys to include, in render order. Default `[]` — no built-in default set. */
  columns?: string[];
  title?: string;
  filter?: Filter | null;
  /** Only `sort.key` of `module_id`/`alias`/`description` is executed here; see the spec's Sort/Filter Execution Model. */
  sort?: Sort | null;
  /** Meaningful only when `view === "grouped"`. `null`/absent groups everything under `"(all)"`. */
  groupBy?: GroupBy | null;
  /** V1 wires the first supplied palette's `name` to the `"tags"` column's `toneBy`. */
  tonePalettes?: TonePalette[];
  /** Honour `ScannedModule.display` overlay for `alias`/`description`. Default `true`. */
  display?: boolean;
}

/**
 * Build a byte-equivalent {@link TuiViewModel} from scanned modules.
 *
 * See `Contract: modules_to_view_model` and the wire-format schema in
 * `apcore-toolkit/docs/features/tui-view-model.md`.
 *
 * Sort/filter execution model: filtering by `tags` / `search` /
 * `annotations` / `exposure` / `deprecated` always executes here. Sorting
 * by `module_id` / `alias` / `description` executes here; any other
 * `sort.key` (e.g. usage-based `calls` / `errors` / `latency`) is honoured
 * verbatim in the incoming `modules` order — the caller is responsible for
 * pre-sorting those.
 */
export function modulesToViewModel(
  modules: ScannedModule[],
  options: ModulesToViewModelOptions = {},
): TuiViewModel {
  const {
    view = 'list',
    columns = [],
    title,
    filter = null,
    sort = null,
    groupBy = null,
    tonePalettes = [],
    display = true,
  } = options;

  // V1 convention: with no explicit per-column wiring in the public API,
  // the first supplied palette (if any) is referenced by the "tags"
  // column's `toneBy` — the only column shape a `tag_equals` rule can
  // meaningfully colour. Per-value tone resolution (which tag chip gets
  // which colour) is a Tier-2 renderer concern, not computed here.
  const tagsPalette = tonePalettes.length > 0 ? tonePalettes[0] : null;

  const columnObjs: Column[] = columns.map((key) => ({
    key,
    label: COLUMN_LABELS[key] ?? key,
    toneBy: tagsPalette !== null && key === 'tags' ? tagsPalette.name : null,
  }));

  const resolved: ResolvedEntry[] = [];
  for (const module of modules) {
    const alias = resolveAlias(module, display);
    const description = resolveDescription(module, display);
    if (!passesFilter(module, filter, description)) continue;
    resolved.push({ module, alias, description });
  }

  if (sort !== null && SORTABLE_KEYS.has(sort.key)) {
    const reverse = sort.direction === 'desc';
    // Array#sort is a stable sort (guaranteed since ES2019 / Node 12+):
    // entries with equal keys retain their original relative order
    // regardless of `reverse`, matching Python's `list.sort(reverse=...)`.
    resolved.sort((a, b) => {
      const ka = sortKeyFor(sort.key, a.module, a.alias, a.description);
      const kb = sortKeyFor(sort.key, b.module, b.alias, b.description);
      const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
      return reverse ? -cmp : cmp;
    });
  }

  const rows: Row[] = resolved.map(({ module, alias, description }) => {
    const cells = columnObjs.map((column): Cell => {
      if (column.key === 'alias') return { kind: 'text', value: alias };
      if (column.key === 'description') return { kind: 'text', value: description };
      return cellFor(column.key, module, display);
    });
    return { cells, tags: [...module.tags] };
  });

  let groups: Group[] | null = null;
  if (view === 'grouped') {
    groups = buildGroups(resolved, groupBy);
  }

  return {
    kind: view,
    title: title ?? null,
    columns: columnObjs,
    rows,
    groups,
    sort,
    filter,
    tonePalettes: tonePalettes.length > 0 ? tonePalettes : null,
  };
}
