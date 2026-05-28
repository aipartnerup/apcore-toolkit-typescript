/**
 * AI-driven metadata enhancement using local SLMs.
 *
 * Uses an OpenAI-compatible local API (e.g., Ollama, vLLM, LM Studio) to fill
 * metadata gaps that static analysis cannot resolve: missing descriptions,
 * behavioral annotation inference, and schema inference for untyped functions.
 *
 * All AI-generated fields are tagged with `x-generated-by: slm` in the module's
 * metadata dict for auditability.
 */

import type { ModuleAnnotations } from 'apcore-js';
import { DEFAULT_ANNOTATIONS } from 'apcore-js';
import type { ScannedModule } from './types.js';
import { cloneModule } from './types.js';

/**
 * SLM-eligible ModuleAnnotations field metadata.
 *
 * Each entry maps the wire-format snake_case key (used in the SLM prompt and
 * the SLM JSON response) to the runtime camelCase key on apcore-js'
 * ModuleAnnotations interface, plus a runtime type validator.
 *
 * Derived from `DEFAULT_ANNOTATIONS` at module load time so that adding a new
 * field upstream automatically widens what the SLM may populate. The `extra`
 * field is excluded — it is reserved for adapter extensions and must not be
 * populated by SLM judgement. `cacheKeyFields` is special-cased because its
 * runtime default is `null`, which `typeof` reports as `'object'`.
 */
interface AnnotationFieldSpec {
  readonly camelKey: keyof ModuleAnnotations;
  readonly validate: (v: unknown) => boolean;
}

function camelToSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function buildAnnotationFieldSpecs(): Map<string, AnnotationFieldSpec> {
  const specs = new Map<string, AnnotationFieldSpec>();
  for (const [camelKey, defaultValue] of Object.entries(DEFAULT_ANNOTATIONS)) {
    if (camelKey === 'extra') continue;
    let validate: (v: unknown) => boolean;
    if (camelKey === 'cacheKeyFields') {
      // Default is null but the field type is `string[] | null`.
      validate = (v) => v === null || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
    } else if (typeof defaultValue === 'boolean') {
      validate = (v) => typeof v === 'boolean';
    } else if (typeof defaultValue === 'number') {
      // Reject booleans (not subclass of number in TS, but be defensive).
      validate = (v) => typeof v === 'number' && Number.isFinite(v);
    } else if (typeof defaultValue === 'string') {
      validate = (v) => typeof v === 'string';
    } else {
      // Unknown shape — skip rather than risk garbage data.
      continue;
    }
    specs.set(camelToSnake(camelKey), {
      camelKey: camelKey as keyof ModuleAnnotations,
      validate,
    });
  }
  return specs;
}

const ANNOTATION_FIELD_SPECS = buildAnnotationFieldSpecs();

const _DEFAULT_ENDPOINT = 'http://localhost:11434/v1';
const _DEFAULT_MODEL = 'qwen:0.6b';
const _DEFAULT_THRESHOLD = 0.7;
const _DEFAULT_BATCH_SIZE = 5;
const _DEFAULT_TIMEOUT = 30;

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const val = Number(raw);
  if (Number.isNaN(val)) throw new Error(`${name} must be a valid number, got "${raw}"`);
  return val;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const val = parseInt(raw, 10);
  if (Number.isNaN(val)) throw new Error(`${name} must be a valid integer, got "${raw}"`);
  return val;
}

/**
 * Protocol for pluggable metadata enhancement.
 *
 * Any class implementing this interface can be used to fill metadata gaps
 * in scanned modules. See the AI Enhancement Guide for details.
 *
 * Cross-SDK parity note: Python's `Enhancer` Protocol and Rust's `Enhancer` trait
 * return `ScannedModule[]` (sync). TypeScript accepts both sync and async
 * implementations via the union return type so that `AIEnhancer` (which performs
 * real async network calls) satisfies the interface while pure-sync implementations
 * (matching Python/Rust convention) also type-check without wrapping in a Promise.
 */
export interface Enhancer {
  enhance(modules: ScannedModule[]): ScannedModule[] | Promise<ScannedModule[]>;
}

export interface AIEnhancerOptions {
  endpoint?: string;
  model?: string;
  threshold?: number;
  batchSize?: number;
  timeout?: number;
}

/**
 * AI-driven metadata enhancement using a local SLM (Small Language Model).
 *
 * Calls an OpenAI-compatible local API (Ollama, vLLM, LM Studio, etc.) to fill
 * metadata gaps that static analysis cannot resolve: missing descriptions,
 * behavioral annotation inference, and input schema generation for untyped
 * functions.
 *
 * Enhancement is gated behind the `APCORE_AI_ENABLED` environment variable.
 * All AI-generated fields are tagged with `x-generated-by: slm` in the module
 * metadata for auditability.
 *
 * TypeScript guards isEnabled() at call site per cross-SDK convention —
 * callers should check `AIEnhancer.isEnabled()` before calling `enhance()`,
 * matching Python/Rust behavior where `enhance()` does not check the flag internally.
 *
 * @example
 * if (AIEnhancer.isEnabled()) {
 *   modules = await enhancer.enhance(modules);
 * }
 */
export class AIEnhancer {
  readonly endpoint: string;
  readonly model: string;
  readonly threshold: number;
  readonly batchSize: number;
  readonly timeout: number;

  constructor(options?: AIEnhancerOptions) {
    this.endpoint = options?.endpoint ?? process.env.APCORE_AI_ENDPOINT ?? _DEFAULT_ENDPOINT;
    this.model = options?.model ?? process.env.APCORE_AI_MODEL ?? _DEFAULT_MODEL;
    this.threshold = options?.threshold ?? parseFloatEnv('APCORE_AI_THRESHOLD', _DEFAULT_THRESHOLD);
    this.batchSize = options?.batchSize ?? parseIntEnv('APCORE_AI_BATCH_SIZE', _DEFAULT_BATCH_SIZE);
    this.timeout = options?.timeout ?? parseIntEnv('APCORE_AI_TIMEOUT', _DEFAULT_TIMEOUT);

    try {
      const parsed = new URL(this.endpoint);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`AIEnhancer endpoint must use http: or https: protocol, got "${parsed.protocol}"`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('AIEnhancer endpoint')) throw err;
      throw new Error(`AIEnhancer endpoint is not a valid URL: ${this.endpoint}`, { cause: err });
    }

    if (this.threshold < 0 || this.threshold > 1) {
      throw new Error('APCORE_AI_THRESHOLD must be a number between 0.0 and 1.0');
    }
    if (this.batchSize <= 0) {
      throw new Error('APCORE_AI_BATCH_SIZE must be a positive integer');
    }
    if (this.timeout <= 0) {
      throw new Error('APCORE_AI_TIMEOUT must be a positive integer');
    }
  }

  static isEnabled(): boolean {
    const val = (process.env.APCORE_AI_ENABLED ?? 'false').toLowerCase();
    return val === 'true' || val === '1' || val === 'yes';
  }

  async enhance(modules: ScannedModule[]): Promise<ScannedModule[]> {
    // Callers should check AIEnhancer.isEnabled() before calling enhance() — matches Python/Rust convention
    const results: ScannedModule[] = [...modules];

    const pending: Array<{ idx: number; module: ScannedModule; gaps: string[] }> = [];
    for (let i = 0; i < modules.length; i++) {
      const gaps = this._identifyGaps(modules[i]);
      if (gaps.length > 0) {
        pending.push({ idx: i, module: modules[i], gaps });
      }
    }

    for (let batchStart = 0; batchStart < pending.length; batchStart += this.batchSize) {
      const batch = pending.slice(batchStart, batchStart + this.batchSize);
      const settled = await Promise.allSettled(
        batch.map(({ module, gaps }) => this._enhanceModule(module, gaps)),
      );
      for (let i = 0; i < batch.length; i++) {
        const { idx, module } = batch[i];
        const outcome = settled[i];
        if (outcome.status === 'fulfilled') {
          results[idx] = outcome.value;
        } else {
          console.warn('AIEnhancer: enhancement failed for %s:', module.moduleId, outcome.reason);
        }
      }
    }

    return results;
  }

  private _annotationsAreDefault(annotations: ScannedModule['annotations']): boolean {
    if (annotations == null) return true;
    const ann = annotations as unknown as Record<string, unknown>;
    const def = DEFAULT_ANNOTATIONS as unknown as Record<string, unknown>;
    return Object.keys(def).every((k) => {
      // `extra` is an object type whose default is Object.freeze({}). Reference
      // equality always fails after cloning, producing spurious SLM calls.
      // The SLM never populates `extra` (excluded from ANNOTATION_FIELD_SPECS),
      // so we skip it here to avoid false "not at default" readings.
      if (k === 'extra') return true;
      return ann[k] === def[k];
    });
  }

  private _identifyGaps(module: ScannedModule): string[] {
    const gaps: string[] = [];
    if (!module.description || module.description === module.moduleId) {
      gaps.push('description');
    }
    if (!module.documentation) {
      gaps.push('documentation');
    }
    if (this._annotationsAreDefault(module.annotations)) {
      gaps.push('annotations');
    }
    const schema = module.inputSchema;
    const props =
      typeof schema === 'object' && schema !== null && !Array.isArray(schema)
        ? (schema as Record<string, unknown>).properties
        : undefined;
    if (!props || (typeof props === 'object' && Object.keys(props).length === 0)) {
      gaps.push('input_schema');
    }
    return gaps;
  }

  private async _enhanceModule(module: ScannedModule, gaps: string[]): Promise<ScannedModule> {
    const prompt = this._buildPrompt(module, gaps);
    const response = await this._callLLM(prompt);
    const parsed = AIEnhancer._parseResponse(response);

    const updates: Record<string, unknown> = {};
    // Build parsedConf from a null-prototype object so attacker-controlled
    // keys like '__proto__' cannot affect prototype lookups.
    const rawConf = parsed.confidence;
    const parsedConf: Record<string, number> = Object.create(null) as Record<string, number>;
    if (rawConf !== null && typeof rawConf === 'object' && !Array.isArray(rawConf)) {
      for (const [k, v] of Object.entries(rawConf as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) parsedConf[k] = v;
      }
    }
    const confidence: Record<string, number> = {};
    const warnings: string[] = [...module.warnings];

    if (gaps.includes('description') && parsed.description) {
      const conf = parsedConf.description ?? 0;
      confidence.description = conf;
      if (conf >= this.threshold) {
        updates.description = parsed.description;
      } else {
        warnings.push(`Low confidence (${conf.toFixed(2)}) for description — skipped. Review manually.`);
      }
    }

    if (gaps.includes('documentation') && parsed.documentation) {
      const conf = parsedConf.documentation ?? 0;
      confidence.documentation = conf;
      if (conf >= this.threshold) {
        updates.documentation = parsed.documentation;
      } else {
        warnings.push(`Low confidence (${conf.toFixed(2)}) for documentation — skipped. Review manually.`);
      }
    }

    if (gaps.includes('annotations') && parsed.annotations && typeof parsed.annotations === 'object') {
      // SLM produces wire-format snake_case keys; ANNOTATION_FIELD_SPECS maps
      // each snake key to the camelCase ModuleAnnotations property and a type
      // validator. Confidence-gated values are merged into the camelCase base
      // so the resulting annotations object is a valid ModuleAnnotations.
      const annData = parsed.annotations as Record<string, unknown>;
      const accepted: Partial<Record<keyof ModuleAnnotations, unknown>> = {};
      for (const [snakeKey, spec] of ANNOTATION_FIELD_SPECS) {
        if (!Object.hasOwn(annData, snakeKey) || !spec.validate(annData[snakeKey])) continue;
        const fieldConf = parsedConf[`annotations.${snakeKey}`] ?? parsedConf[snakeKey] ?? 0;
        confidence[`annotations.${snakeKey}`] = fieldConf;
        if (fieldConf >= this.threshold) {
          accepted[spec.camelKey] = annData[snakeKey];
        } else {
          warnings.push(`Low confidence (${fieldConf.toFixed(2)}) for annotations.${snakeKey} — skipped. Review manually.`);
        }
      }
      if (Object.keys(accepted).length > 0) {
        const base = module.annotations ?? { ...DEFAULT_ANNOTATIONS };
        updates.annotations = { ...base, ...accepted };
      }
    }

    if (gaps.includes('input_schema') && parsed.input_schema) {
      const conf = parsedConf.input_schema ?? 0;
      confidence.input_schema = conf;
      const s = parsed.input_schema;
      const isValidShape = typeof s === 'object' && !Array.isArray(s) && s !== null && 'type' in (s as object);
      if (!isValidShape) {
        warnings.push('SLM returned malformed input_schema (missing "type") — skipped. Review manually.');
      } else if (conf >= this.threshold) {
        updates.inputSchema = s;
      } else {
        warnings.push(`Low confidence (${conf.toFixed(2)}) for input_schema — skipped. Review manually.`);
      }
    }

    if (Object.keys(updates).length === 0) {
      if (warnings.length !== module.warnings.length) {
        return cloneModule(module, { warnings });
      }
      return module;
    }

    const metadata: Record<string, unknown> = { ...module.metadata };
    metadata['x-generated-by'] = 'slm';
    metadata['x-ai-confidence'] = confidence;

    return cloneModule(module, { ...updates, metadata, warnings } as Partial<ScannedModule>);
  }

  private _buildPrompt(module: ScannedModule, gaps: string[]): string {
    const parts = [
      'You are analyzing a function to generate metadata for an AI-perceivable module system.',
      '',
      `Module ID: ${module.moduleId}`,
      `Target: ${module.target}`,
    ];
    if (module.description) {
      parts.push(`Current description: ${module.description}`);
    }

    parts.push('');
    parts.push('Please provide the following missing metadata as JSON:');
    parts.push('{');

    if (gaps.includes('description')) {
      parts.push('  "description": "<≤200 chars, what this function does>",');
    }
    if (gaps.includes('documentation')) {
      parts.push('  "documentation": "<detailed Markdown explanation>",');
    }
    if (gaps.includes('annotations')) {
      parts.push('  "annotations": {');
      parts.push('    "readonly": <true if no side effects>,');
      parts.push('    "destructive": <true if deletes/overwrites data>,');
      parts.push('    "idempotent": <true if safe to retry>,');
      parts.push('    "requires_approval": <true if dangerous operation>,');
      parts.push('    "open_world": <true if calls external systems>,');
      parts.push('    "streaming": <true if yields results incrementally>,');
      parts.push('    "cacheable": <true if results can be cached>,');
      parts.push('    "cache_ttl": <seconds, 0 for no expiry>,');
      parts.push('    "cache_key_fields": <list of input field names for cache key, or null for all>,');
      parts.push('    "paginated": <true if supports pagination>,');
      parts.push('    "pagination_style": <"cursor" or "offset" or "page">');
      parts.push('  },');
    }
    if (gaps.includes('input_schema')) {
      parts.push('  "input_schema": <JSON Schema object for function parameters>,');
    }

    // Build confidence keys dynamically from all annotation fields so the
    // prompt stays in sync as DEFAULT_ANNOTATIONS evolves upstream.
    const confidenceKeys = Object.fromEntries(
      Object.keys(DEFAULT_ANNOTATIONS)
        .filter(k => k !== 'extra')
        .map(k => [camelToSnake(k), 0.0])
    );
    const confidenceKeysJson = JSON.stringify(confidenceKeys, null, 4)
      .split('\n')
      .map((l, i) => i === 0 ? `  "confidence": ${l}` : `  ${l}`)
      .join('\n');
    parts.push(confidenceKeysJson);
    parts.push('}');
    parts.push('');
    parts.push('Respond with ONLY valid JSON, no markdown fences or explanation.');

    return parts.join('\n');
  }

  private async _callLLM(prompt: string): Promise<string> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;
    const payload = JSON.stringify({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`SLM API returned ${resp.status}: ${resp.statusText}`);
      }

      const data = (await resp.json()) as Record<string, unknown>;
      const choices = data.choices as Array<{ message: { content: string } }> | undefined;
      if (!choices?.[0]?.message?.content) {
        throw new Error('Unexpected API response structure');
      }
      return choices[0].message.content;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`SLM request timed out after ${this.timeout}s`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static _parseResponse(response: string): Record<string, unknown> {
    let text = response.trim();
    // Strip markdown code fence: ```[lang]\n ... \n``` (closing fence optional)
    if (text.startsWith('```')) {
      const firstNl = text.indexOf('\n');
      if (firstNl === -1) {
        text = '';
      } else {
        text = text.slice(firstNl + 1);
        if (text.endsWith('```')) {
          const lastNl = text.lastIndexOf('\n');
          text = lastNl === -1 ? '' : text.slice(0, lastNl);
        }
        text = text.trim();
      }
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`SLM returned invalid JSON: ${(err as Error).message}`, { cause: err });
    }
  }
}
