import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAnnotations, DEFAULT_ANNOTATIONS } from 'apcore-js';
import { AIEnhancer } from '../src/ai-enhancer.js';
import { createScannedModule } from '../src/types.js';

describe('AIEnhancer', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env vars
    delete process.env.APCORE_AI_ENABLED;
    delete process.env.APCORE_AI_ENDPOINT;
    delete process.env.APCORE_AI_MODEL;
    delete process.env.APCORE_AI_THRESHOLD;
    delete process.env.APCORE_AI_BATCH_SIZE;
    delete process.env.APCORE_AI_TIMEOUT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isEnabled', () => {
    it('returns false by default', () => {
      expect(AIEnhancer.isEnabled()).toBe(false);
    });

    it('returns true when APCORE_AI_ENABLED=true', () => {
      process.env.APCORE_AI_ENABLED = 'true';
      expect(AIEnhancer.isEnabled()).toBe(true);
    });

    it('returns true when APCORE_AI_ENABLED=1', () => {
      process.env.APCORE_AI_ENABLED = '1';
      expect(AIEnhancer.isEnabled()).toBe(true);
    });

    it('returns true when APCORE_AI_ENABLED=yes', () => {
      process.env.APCORE_AI_ENABLED = 'yes';
      expect(AIEnhancer.isEnabled()).toBe(true);
    });

    it('returns false for other values', () => {
      process.env.APCORE_AI_ENABLED = 'false';
      expect(AIEnhancer.isEnabled()).toBe(false);
    });
  });

  describe('enhance failure path (D8-1 regression)', () => {
    it('returns original module and warns when _callLLM throws', async () => {
      process.env.APCORE_AI_ENABLED = 'true';
      const mod = createScannedModule({
        moduleId: 'fail.module',
        description: 'fail.module',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tags: [],
        target: 'fail:fn',
      });

      const enhancer = new AIEnhancer();
      const callLLM = vi
        .spyOn(enhancer as unknown as { _callLLM: (p: string) => Promise<string> }, '_callLLM')
        .mockRejectedValue(new Error('SLM unreachable'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const [result] = await enhancer.enhance([mod]);

      expect(result).toBe(mod); // original returned unchanged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('AIEnhancer'),
        expect.stringContaining('fail.module'),
        expect.objectContaining({ message: 'SLM unreachable' }),
      );

      callLLM.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('constructor', () => {
    it('uses defaults when no options or env vars', () => {
      const enhancer = new AIEnhancer();
      expect(enhancer.endpoint).toBe('http://localhost:11434/v1');
      expect(enhancer.model).toBe('qwen:0.6b');
      expect(enhancer.threshold).toBe(0.7);
      expect(enhancer.batchSize).toBe(5);
      expect(enhancer.timeout).toBe(30);
    });

    it('accepts constructor options', () => {
      const enhancer = new AIEnhancer({
        endpoint: 'http://custom:8080/v1',
        model: 'llama3',
        threshold: 0.5,
        batchSize: 10,
        timeout: 60,
      });
      expect(enhancer.endpoint).toBe('http://custom:8080/v1');
      expect(enhancer.model).toBe('llama3');
      expect(enhancer.threshold).toBe(0.5);
      expect(enhancer.batchSize).toBe(10);
      expect(enhancer.timeout).toBe(60);
    });

    it('reads from env vars when no options', () => {
      process.env.APCORE_AI_ENDPOINT = 'http://env:9090/v1';
      process.env.APCORE_AI_MODEL = 'phi3';
      process.env.APCORE_AI_THRESHOLD = '0.9';
      process.env.APCORE_AI_BATCH_SIZE = '3';
      process.env.APCORE_AI_TIMEOUT = '15';
      const enhancer = new AIEnhancer();
      expect(enhancer.endpoint).toBe('http://env:9090/v1');
      expect(enhancer.model).toBe('phi3');
      expect(enhancer.threshold).toBe(0.9);
      expect(enhancer.batchSize).toBe(3);
      expect(enhancer.timeout).toBe(15);
    });

    it('throws for invalid threshold', () => {
      expect(() => new AIEnhancer({ threshold: 1.5 })).toThrow('between 0.0 and 1.0');
    });

    it('throws for invalid batchSize', () => {
      expect(() => new AIEnhancer({ batchSize: 0 })).toThrow('positive integer');
    });

    it('throws for invalid timeout', () => {
      expect(() => new AIEnhancer({ timeout: -1 })).toThrow('positive integer');
    });
  });

  describe('_parseResponse', () => {
    // _parseResponse is private; accessed via type cast for unit testing internals.
    const parseResponse = (s: string) => (AIEnhancer as any)._parseResponse(s) as Record<string, unknown>;

    it('parses plain JSON', () => {
      const result = parseResponse('{"description": "test"}');
      expect(result).toEqual({ description: 'test' });
    });

    it('strips markdown code fences', () => {
      const result = parseResponse('```json\n{"description": "test"}\n```');
      expect(result).toEqual({ description: 'test' });
    });

    it('throws for invalid JSON', () => {
      expect(() => parseResponse('not json')).toThrow('invalid JSON');
    });
  });

  describe('enhance', () => {
    it('returns modules unchanged when no gaps', async () => {
      const mod = createScannedModule({
        moduleId: 'test.mod',
        description: 'A real description',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        outputSchema: { type: 'object' },
        tags: ['test'],
        target: 'test:mod',
        documentation: 'Full docs here',
        annotations: createAnnotations({ readonly: true }),
      });
      const enhancer = new AIEnhancer();
      const result = await enhancer.enhance([mod]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mod); // same reference, no changes
    });

    it('merges SLM snake_case annotation fields into camelCase ModuleAnnotations', async () => {
      process.env.APCORE_AI_ENABLED = 'true';
      // Regression: SLM emits wire-format snake_case keys; AI Enhancer must
      // map them to apcore-js camelCase fields rather than spreading raw
      // snake_case keys onto the runtime object (which would silently lose
      // the SLM judgement and leave camelCase defaults in place).
      const mod = createScannedModule({
        moduleId: 'test.gap',
        description: 'test.gap',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tags: [],
        target: 'test:gap',
      });
      const slmJson = JSON.stringify({
        annotations: {
          requires_approval: true,
          open_world: false,
          cache_ttl: 600,
          cache_key_fields: ['id'],
          pagination_style: 'offset',
        },
        confidence: {
          'annotations.requires_approval': 0.95,
          'annotations.open_world': 0.95,
          'annotations.cache_ttl': 0.95,
          'annotations.cache_key_fields': 0.95,
          'annotations.pagination_style': 0.95,
        },
      });
      const enhancer = new AIEnhancer();
      const callLLM = vi
        .spyOn(enhancer as unknown as { _callLLM: (p: string) => Promise<string> }, '_callLLM')
        .mockResolvedValue(slmJson);

      const [enhanced] = await enhancer.enhance([mod]);
      callLLM.mockRestore();

      const ann = enhanced.annotations as Record<string, unknown> | null;
      expect(ann).not.toBeNull();
      // camelCase fields received the SLM judgement.
      expect(ann!.requiresApproval).toBe(true);
      expect(ann!.openWorld).toBe(false);
      expect(ann!.cacheTtl).toBe(600);
      expect(ann!.cacheKeyFields).toEqual(['id']);
      expect(ann!.paginationStyle).toBe('offset');
      // Snake_case keys must NOT have leaked through onto the runtime object.
      expect(ann).not.toHaveProperty('requires_approval');
      expect(ann).not.toHaveProperty('open_world');
      expect(ann).not.toHaveProperty('cache_ttl');
      expect(ann).not.toHaveProperty('cache_key_fields');
      expect(ann).not.toHaveProperty('pagination_style');
    });
  });

  // _annotationsAreDefault reference-equality regression (D6-annotations)
  describe('_annotationsAreDefault reference equality fix', () => {
    it('treats annotations with a different extra reference as default (gap IS detected)', async () => {
      // Before the fix: `extra` reference differed → _annotationsAreDefault returned
      // `false` (not-default) → gap skipped → SLM never called → annotations never enhanced.
      // After the fix: `extra` is excluded from comparison → returns `true` (is-default)
      // → gap IS detected → SLM IS called.
      process.env.APCORE_AI_ENABLED = 'true';

      const freshAnnotations = { ...DEFAULT_ANNOTATIONS, extra: {} };
      const mod = createScannedModule({
        moduleId: 'has-defaults',
        description: 'a real description',
        documentation: 'full docs',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        outputSchema: { type: 'object' },
        tags: [],
        target: 'mod:fn',
        annotations: freshAnnotations,
      });

      const enhancer = new AIEnhancer();
      const callLLM = vi
        .spyOn(enhancer as unknown as { _callLLM: (p: string) => Promise<string> }, '_callLLM')
        .mockResolvedValue('{"confidence":{}}');

      await enhancer.enhance([mod]);

      // With the fix applied, annotations ARE detected as default and the gap
      // IS pushed, causing _callLLM to be invoked.
      expect(callLLM).toHaveBeenCalledOnce();

      callLLM.mockRestore();
    });

    it('does not detect an annotation gap when annotations have a non-default value', async () => {
      // A module with at least one custom annotation should NOT get an annotation gap.
      process.env.APCORE_AI_ENABLED = 'true';

      const customAnnotations = { ...DEFAULT_ANNOTATIONS, extra: {}, readonly: true };
      const mod = createScannedModule({
        moduleId: 'has-custom',
        description: 'a real description',
        documentation: 'full docs',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        outputSchema: { type: 'object' },
        tags: [],
        target: 'mod:fn',
        annotations: customAnnotations,
      });

      const enhancer = new AIEnhancer();
      const callLLM = vi
        .spyOn(enhancer as unknown as { _callLLM: (p: string) => Promise<string> }, '_callLLM')
        .mockResolvedValue('{"confidence":{}}');

      await enhancer.enhance([mod]);

      // readonly: true diverges from DEFAULT_ANNOTATIONS.readonly = false
      // so _annotationsAreDefault returns false → no annotation gap → _callLLM not called
      expect(callLLM).not.toHaveBeenCalled();

      callLLM.mockRestore();
    });
  });

  describe('parsedConf Pattern A regression', () => {
    it('confidence with non-numeric values does not pollute and is safely ignored', async () => {
      process.env.APCORE_AI_ENABLED = 'true';
      const mod = createScannedModule({
        moduleId: 'proto.test',
        description: 'proto.test',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tags: [],
        target: 'mod:fn',
      });
      const enhancer = new AIEnhancer();
      // Spy on _callLLM to return a malicious confidence object
      const callLLM = vi.spyOn(enhancer as unknown as { _callLLM: (p: string) => Promise<string> }, '_callLLM');
      callLLM.mockResolvedValueOnce(
        JSON.stringify({
          description: 'A module',
          confidence: { description: 'not-a-number', __proto__: 1.0 },
        }),
      );
      const result = await enhancer.enhance([mod]);
      // __proto__ as a confidence key must not affect behavior
      expect(result).toHaveLength(1);
      callLLM.mockRestore();
    });
  });

  // _parseResponse fence-stripping regression
  describe('_parseResponse fence stripping', () => {
    const parse = (AIEnhancer as unknown as { _parseResponse: (r: string) => Record<string, unknown> })._parseResponse.bind(AIEnhancer);

    it('parses plain JSON without fence', () => {
      expect(parse('{"a":1}')).toEqual({ a: 1 });
    });

    it('strips ```json...``` fence', () => {
      expect(parse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('strips ``` fence without language specifier', () => {
      expect(parse('```\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('strips fence without closing backticks', () => {
      expect(parse('```json\n{"a":1}')).toEqual({ a: 1 });
    });

    it('throws on bare triple-backtick (no content)', () => {
      expect(() => parse('```')).toThrow('SLM returned invalid JSON');
    });
  });
});
