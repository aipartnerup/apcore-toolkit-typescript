/**
 * Surface-aware formatters.
 *
 * Render `ScannedModule` and JSON Schema for specific consumer surfaces:
 * LLM context (markdown), agent skill files (skill), CLI listings (table-row),
 * and programmatic APIs (json). See
 * `apcore-toolkit/docs/features/formatting.md`.
 */

import type { ScannedModule } from '../types.js';
import { annotationsToDict, moduleToDict } from '../serializers.js';

export type SchemaStyle = 'prose' | 'table' | 'json';
export type ModuleStyle = 'markdown' | 'skill' | 'table-row' | 'json';
export type GroupBy = 'tag' | 'prefix';

const SCHEMA_STYLES: readonly SchemaStyle[] = ['prose', 'table', 'json'];
const MODULE_STYLES: readonly ModuleStyle[] = ['markdown', 'skill', 'table-row', 'json'];
const GROUP_BY_VALUES: readonly GroupBy[] = ['tag', 'prefix'];

export interface FormatSchemaOptions {
  style?: SchemaStyle;
  maxDepth?: number;
}

export interface FormatModuleOptions {
  style?: ModuleStyle;
  display?: boolean;
}

export interface FormatModulesOptions {
  style?: ModuleStyle;
  groupBy?: GroupBy | null;
  display?: boolean;
}

/**
 * Render a JSON Schema for a specific surface.
 * See `Contract: format_schema` in
 * `apcore-toolkit/docs/features/formatting.md`.
 */
export function formatSchema(
  schema: Record<string, unknown>,
  options: FormatSchemaOptions = {},
): string | Record<string, unknown> {
  const style = options.style ?? 'prose';
  const maxDepth = options.maxDepth ?? 3;

  if (!SCHEMA_STYLES.includes(style)) {
    throw new Error(
      `formatSchema: unknown style ${JSON.stringify(style)}; expected one of ${JSON.stringify(SCHEMA_STYLES)}`,
    );
  }
  if (style === 'json') {
    return schema;
  }

  if (!schema || typeof schema !== 'object') {
    return '';
  }

  const type = (schema as Record<string, unknown>)['type'];
  const properties = (schema as Record<string, unknown>)['properties'];

  if (type !== 'object' || !properties || typeof properties !== 'object') {
    if (type && type !== 'object') {
      return `_schema accepts ${type}_`;
    }
    if (style === 'prose') {
      return '';
    }
    return '| Name | Type | Required | Default | Description |\n|---|---|---|---|---|\n';
  }

  const required = new Set<string>(
    Array.isArray((schema as Record<string, unknown>)['required'])
      ? ((schema as Record<string, unknown>)['required'] as string[])
      : [],
  );

  if (style === 'prose') {
    return formatSchemaProse(properties as Record<string, unknown>, required, maxDepth, 0);
  }
  return formatSchemaTable(properties as Record<string, unknown>, required);
}

function formatSchemaProse(
  properties: Record<string, unknown>,
  required: Set<string>,
  maxDepth: number,
  depth: number,
): string {
  const lines: string[] = [];
  for (const [name, propRaw] of Object.entries(properties)) {
    const prop = (typeof propRaw === 'object' && propRaw !== null) ? propRaw as Record<string, unknown> : {};
    const type = (prop['type'] as string) ?? 'any';
    const reqLabel = required.has(name) ? 'required' : 'optional';
    const desc = ((prop['description'] as string) ?? '').trim();
    let head = `- \`${name}\` (${type}, ${reqLabel})`;
    if (desc) {
      head += ` — ${desc}`;
    }
    lines.push(head);

    if (
      prop['type'] === 'object' &&
      typeof prop['properties'] === 'object' &&
      prop['properties'] !== null
    ) {
      if (depth + 1 >= maxDepth) {
        lines.push('  ```json');
        for (const jsonLine of JSON.stringify(prop, null, 2).split('\n')) {
          lines.push(`  ${jsonLine}`);
        }
        lines.push('  ```');
      } else {
        const nestedRequired = new Set<string>(
          Array.isArray(prop['required']) ? (prop['required'] as string[]) : [],
        );
        const nested = formatSchemaProse(
          prop['properties'] as Record<string, unknown>,
          nestedRequired,
          maxDepth,
          depth + 1,
        );
        for (const nestedLine of nested.split('\n')) {
          lines.push(`  ${nestedLine}`);
        }
      }
    }
  }
  return lines.join('\n');
}

function formatSchemaTable(
  properties: Record<string, unknown>,
  required: Set<string>,
): string {
  const rows: string[] = [
    '| Name | Type | Required | Default | Description |',
    '|---|---|---|---|---|',
  ];
  for (const [name, propRaw] of Object.entries(properties)) {
    const prop = (typeof propRaw === 'object' && propRaw !== null) ? propRaw as Record<string, unknown> : {};
    const type = (prop['type'] as string) ?? 'any';
    const reqLabel = required.has(name) ? 'yes' : 'no';
    const desc = ((prop['description'] as string) ?? '').trim();
    let defaultStr = '';
    if (prop['default'] !== undefined) {
      const d = prop['default'];
      defaultStr = typeof d === 'object' ? JSON.stringify(d) : String(d);
    }
    rows.push(`| \`${name}\` | ${type} | ${reqLabel} | ${defaultStr} | ${desc} |`);
  }
  return rows.join('\n');
}

/**
 * Render a single ScannedModule for the chosen surface.
 * See `Contract: format_module` in
 * `apcore-toolkit/docs/features/formatting.md`.
 */
export function formatModule(
  module: ScannedModule,
  options: FormatModuleOptions = {},
): string | Record<string, unknown> {
  const style = options.style ?? 'markdown';
  const display = options.display ?? true;

  if (!MODULE_STYLES.includes(style)) {
    throw new Error(
      `formatModule: unknown style ${JSON.stringify(style)}; expected one of ${JSON.stringify(MODULE_STYLES)}`,
    );
  }

  if (style === 'json') {
    return moduleToDict(module);
  }

  const { title, description, guidance, tags } = resolveDisplayFields(module, display);

  if (style === 'table-row') {
    const alias = title !== module.moduleId ? title : '';
    const tagStr = tags.length > 0 ? tags.join(', ') : '';
    return `\`${module.moduleId}\` │ \`${alias}\` │ ${description} │ ${tagStr}`;
  }

  const body = renderModuleMarkdownBody(module, title, description, guidance, tags);

  if (style === 'skill') {
    const oneLine = description.replace(/\n/g, ' ').trim();
    const frontmatter = `---\nname: ${title}\ndescription: ${yamlScalar(oneLine)}\n---\n\n`;
    return frontmatter + body;
  }

  return body;
}

function resolveDisplayFields(
  module: ScannedModule,
  useDisplay: boolean,
): { title: string; description: string; guidance: string | null; tags: string[] } {
  const rawTitle = module.moduleId;
  const rawDesc = module.description ?? '';
  const rawTags = module.tags ? [...module.tags] : [];

  if (!useDisplay || !module.display) {
    return { title: rawTitle, description: rawDesc, guidance: null, tags: rawTags };
  }

  const overlay = module.display;
  const title = (overlay['alias'] as string) || rawTitle;
  const description = (overlay['description'] as string) || rawDesc;
  const guidance = (overlay['guidance'] as string) || null;
  const tagsOverlay = overlay['tags'];
  const tags = Array.isArray(tagsOverlay) && tagsOverlay.length > 0
    ? (tagsOverlay as string[])
    : rawTags;
  return { title, description, guidance, tags: [...tags] };
}

function renderModuleMarkdownBody(
  module: ScannedModule,
  title: string,
  description: string,
  guidance: string | null,
  tags: string[],
): string {
  const sections: string[] = [];
  sections.push(`# ${title}`);
  if (description) {
    sections.push(description);
  }
  if (guidance) {
    sections.push(`_${guidance}_`);
  }

  sections.push('## Parameters');
  const paramsProse = formatSchema(module.inputSchema ?? {}, { style: 'prose' }) as string;
  sections.push(paramsProse ? paramsProse : '_(no parameters)_');

  sections.push('## Returns');
  const returnsProse = formatSchema(module.outputSchema ?? {}, { style: 'prose' }) as string;
  sections.push(returnsProse ? returnsProse : '_(no return schema)_');

  const annotationTable = renderAnnotationsTable(module.annotations);
  if (annotationTable) {
    sections.push('## Behavior');
    sections.push(annotationTable);
  }

  if (module.examples && module.examples.length > 0) {
    sections.push('## Examples');
    let idx = 1;
    for (const example of module.examples) {
      sections.push(`### Example ${idx}`);
      sections.push('```json');
      sections.push(JSON.stringify(example, null, 2));
      sections.push('```');
      idx += 1;
    }
  }

  if (tags.length > 0) {
    sections.push('## Tags');
    sections.push(tags.map((t) => `\`${t}\``).join(', '));
  }

  return sections.join('\n\n') + '\n';
}

function renderAnnotationsTable(annotations: unknown): string | null {
  const data = annotationsToDict(annotations);
  if (!data) return null;
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'extra') continue;
    if (
      value === null ||
      value === undefined ||
      value === false ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)
    ) {
      continue;
    }
    entries.push([key, value]);
  }
  if (entries.length === 0) return null;
  const rows = ['| Flag | Value |', '|---|---|'];
  for (const [key, value] of entries) {
    const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
    rows.push(`| \`${key}\` | ${rendered} |`);
  }
  return rows.join('\n');
}

function yamlScalar(text: string): string {
  if (text === '') return '""';
  const needsQuote = /[:#{}[\]'"\n&*!|>]/.test(text);
  if (!needsQuote && !/^[-?%@`]/.test(text)) {
    return text;
  }
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Render a sequence of ScannedModule for the chosen surface.
 * See `Contract: format_modules` in
 * `apcore-toolkit/docs/features/formatting.md`.
 */
export function formatModules(
  modules: ScannedModule[],
  options: FormatModulesOptions = {},
): string | Record<string, unknown>[] {
  const style = options.style ?? 'markdown';
  const groupBy = options.groupBy ?? null;
  const display = options.display ?? true;

  if (!MODULE_STYLES.includes(style)) {
    throw new Error(
      `formatModules: unknown style ${JSON.stringify(style)}; expected one of ${JSON.stringify(MODULE_STYLES)}`,
    );
  }
  if (groupBy !== null && !GROUP_BY_VALUES.includes(groupBy)) {
    throw new Error(
      `formatModules: unknown groupBy ${JSON.stringify(groupBy)}; expected one of ${JSON.stringify(GROUP_BY_VALUES)} or null`,
    );
  }

  if (style === 'json') {
    return modules.map((m) => moduleToDict(m));
  }

  const joiner = (style === 'markdown' || style === 'skill') ? '\n\n' : '\n';

  if (groupBy === null) {
    return modules
      .map((m) => formatModule(m, { style, display }) as string)
      .join(joiner);
  }

  const groups = groupModules(modules, groupBy);
  const out: string[] = [];
  for (const [groupName, groupMembers] of groups) {
    if (style === 'markdown' || style === 'skill') {
      out.push(`## ${groupName}`);
    } else {
      out.push(`── ${groupName} ──`);
    }
    for (const m of groupMembers) {
      out.push(formatModule(m, { style, display }) as string);
    }
  }
  return out.join(joiner);
}

function groupModules(
  modules: ScannedModule[],
  groupBy: GroupBy,
): Map<string, ScannedModule[]> {
  const groups = new Map<string, ScannedModule[]>();
  for (const module of modules) {
    if (groupBy === 'prefix') {
      const idx = module.moduleId.indexOf('.');
      const prefix = idx >= 0 ? module.moduleId.slice(0, idx) : module.moduleId;
      const arr = groups.get(prefix) ?? [];
      arr.push(module);
      groups.set(prefix, arr);
    } else {
      // groupBy === 'tag'
      if (!module.tags || module.tags.length === 0) {
        const arr = groups.get('(untagged)') ?? [];
        arr.push(module);
        groups.set('(untagged)', arr);
        continue;
      }
      for (const tag of module.tags) {
        const arr = groups.get(tag) ?? [];
        arr.push(module);
        groups.set(tag, arr);
      }
    }
  }
  return groups;
}
