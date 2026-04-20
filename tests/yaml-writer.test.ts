import { describe, it, expect, vi } from 'vitest';
import { createAnnotations } from 'apcore-js';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YAMLWriter } from '../src/output/yaml-writer.js';
import { createScannedModule } from '../src/types.js';
import type { WriteResult } from '../src/output/types.js';
import { YAMLVerifier } from '../src/output/verifiers.js';

const REQUIRED_FIELDS = {
  moduleId: 'test-module',
  description: 'A test module',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'string' },
  tags: ['test', 'example'],
  target: 'http://localhost:8080/api/test',
} as const;

function makeModule(overrides: Record<string, unknown> = {}) {
  return createScannedModule({ ...REQUIRED_FIELDS, ...overrides } as Parameters<typeof createScannedModule>[0]);
}

describe('YAMLWriter', () => {
  describe('empty modules', () => {
    it('returns empty array for empty input', () => {
      const writer = new YAMLWriter();
      const result = writer.write([], '/tmp/unused');
      expect(result).toEqual([]);
    });
  });

  describe('dry run', () => {
    it('returns WriteResult without writing files', () => {
      const writer = new YAMLWriter();
      const mod = makeModule();
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-dry-'));

      const results = writer.write([mod], tmpDir, { dryRun: true });

      expect(results).toHaveLength(1);
      expect(results[0].moduleId).toBe('test-module');
      expect(results[0].path).toBeNull();
      expect(results[0].verified).toBe(true);
      // No files should have been written
      const files = readdirSync(tmpDir);
      expect(files).toHaveLength(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does not create output directory in dry run mode', () => {
      const writer = new YAMLWriter();
      const mod = makeModule();
      const nonExistentDir = join(tmpdir(), 'yaml-writer-nonexistent-' + Date.now());

      const results = writer.write([mod], nonExistentDir, { dryRun: true });

      expect(results).toHaveLength(1);
      expect(existsSync(nonExistentDir)).toBe(false);
    });
  });

  describe('WriteResult structure', () => {
    it('returns WriteResult with correct fields on actual write', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'result-test' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-result-'));

      const results: WriteResult[] = writer.write([mod], tmpDir);

      expect(results).toHaveLength(1);
      expect(results[0].moduleId).toBe('result-test');
      expect(results[0].path).toContain('result-test.binding.yaml');
      expect(results[0].verified).toBe(true);
      expect(results[0].verificationError).toBeNull();

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('verification support', () => {
    it('runs verifiers when verify=true', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'verify-test' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-verify-'));

      const results = writer.write([mod], tmpDir, {
        verify: true,
        verifiers: [new YAMLVerifier()],
      });

      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(true);
      expect(results[0].verificationError).toBeNull();

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('skips verification when verify=false (default)', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'no-verify-test' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-noverify-'));

      const results = writer.write([mod], tmpDir);

      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(true);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('file content', () => {
    it('writes valid YAML with all fields', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({
        moduleId: 'content-test',
        version: '2.0.0',
        annotations: createAnnotations({ readonly: true, requiresApproval: true }),
        documentation: 'Some docs',
        examples: [{ name: 'ex1', input: { key: 'val' }, output: { result: 'ok' } }],
        metadata: { author: 'test' },
      });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-content-'));

      writer.write([mod], tmpDir);

      const filePath = join(tmpDir, 'content-test.binding.yaml');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('spec_version:');
      expect(content).toContain('module_id: content-test');
      expect(content).toContain('version: 2.0.0');
      expect(content).toContain('documentation: Some docs');
      // Annotations must be emitted in snake_case wire format for cross-language interop.
      expect(content).toContain('readonly: true');
      expect(content).toContain('requires_approval: true');
      expect(content).not.toContain('requiresApproval');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('omits display key when module.display is null', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'no-display' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-nodisplay-'));

      writer.write([mod], tmpDir);

      const content = readFileSync(join(tmpDir, 'no-display.binding.yaml'), 'utf-8');
      expect(content).not.toContain('display:');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('emits display overlay when module.display is set', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({
        moduleId: 'with-display',
        display: { mcp: { alias: 'users_get' }, alias: 'users.get' },
      });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-display-'));

      writer.write([mod], tmpDir);

      const content = readFileSync(join(tmpDir, 'with-display.binding.yaml'), 'utf-8');
      expect(content).toContain('display:');
      expect(content).toContain('alias: users_get');
      expect(content).toContain('alias: users.get');

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('filename sanitization', () => {
    it('sanitizes weird/id..test to weird_id_test.binding.yaml', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'weird/id..test' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-sanitize-'));

      writer.write([mod], tmpDir);

      const files = readdirSync(tmpDir);
      expect(files).toContain('weird_id_test.binding.yaml');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('sanitizes special characters to underscores', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'my@module#v1' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-sanitize2-'));

      writer.write([mod], tmpDir);

      const files = readdirSync(tmpDir);
      expect(files).toContain('my_module_v1.binding.yaml');

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('suggestedAlias round-trip', () => {
    it('preserves suggested_alias in written YAML (regression for D1-1)', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'alias-test', suggestedAlias: 'my_alias' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-alias-'));

      writer.write([mod], tmpDir);

      const content = readFileSync(join(tmpDir, 'alias-test.binding.yaml'), 'utf-8');
      expect(content).toContain('suggested_alias: my_alias');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('omits suggested_alias when null', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'no-alias-test' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-noalias-'));

      writer.write([mod], tmpDir);

      const content = readFileSync(join(tmpDir, 'no-alias-test.binding.yaml'), 'utf-8');
      expect(content).not.toContain('suggested_alias:');

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('file writing', () => {
    it('writes valid YAML with header to a temp directory', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'write-test' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-write-'));

      const results = writer.write([mod], tmpDir);

      expect(results).toHaveLength(1);
      const filePath = join(tmpDir, 'write-test.binding.yaml');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# Auto-generated by apcore-toolkit scanner');
      expect(content).toContain('# Generated:');
      expect(content).toContain('# Do not edit manually unless you intend to customize schemas.');
      expect(content).toContain('module_id: write-test');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates output directory if it does not exist', () => {
      const writer = new YAMLWriter();
      const mod = makeModule({ moduleId: 'mkdir-test' });
      const tmpDir = join(tmpdir(), 'yaml-writer-mkdir-' + Date.now(), 'nested');

      writer.write([mod], tmpDir);

      expect(existsSync(tmpDir)).toBe(true);
      expect(existsSync(join(tmpDir, 'mkdir-test.binding.yaml'))).toBe(true);

      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('writes multiple modules to separate files', () => {
      const writer = new YAMLWriter();
      const mod1 = makeModule({ moduleId: 'mod-a' });
      const mod2 = makeModule({ moduleId: 'mod-b' });
      const tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-multi-'));

      const results = writer.write([mod1, mod2], tmpDir);

      expect(results).toHaveLength(2);
      expect(existsSync(join(tmpDir, 'mod-a.binding.yaml'))).toBe(true);
      expect(existsSync(join(tmpDir, 'mod-b.binding.yaml'))).toBe(true);

      rmSync(tmpDir, { recursive: true, force: true });
    });

  });

  // Symlink escape regression (D2-symlink)
  describe('symlink escape protection', () => {
    it('blocks write when output file is a symlink pointing outside outputDir', () => {
      const outputDir = mkdtempSync(join(tmpdir(), 'yaml-writer-symlink-'));
      const escapeDir = mkdtempSync(join(tmpdir(), 'yaml-writer-escape-'));
      const escapedFile = join(escapeDir, 'escape.binding.yaml');
      const symlinkPath = join(outputDir, 'escape.binding.yaml');

      // Pre-create the symlink target so realpathSync resolves correctly
      writeFileSync(escapedFile, 'original content');
      symlinkSync(escapedFile, symlinkPath);

      const mod = makeModule({ moduleId: 'escape' });
      const writer = new YAMLWriter();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      writer.write([mod], outputDir);

      // Target outside outputDir must NOT be overwritten
      expect(readFileSync(escapedFile, 'utf-8')).toBe('original content');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping symlink escape at'),
        expect.any(String),
      );

      warnSpy.mockRestore();
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(escapeDir, { recursive: true, force: true });
    });

    // W18 regression: symlink-escape skip should return a failed WriteResult
    it('returns failed WriteResult when output file is a symlink (W18)', () => {
      const outputDir = mkdtempSync(join(tmpdir(), 'yaml-writer-w18-'));
      const escapeDir = mkdtempSync(join(tmpdir(), 'yaml-writer-w18-esc-'));
      const escapedFile = join(escapeDir, 'escape.binding.yaml');
      const symlinkPath = join(outputDir, 'escape.binding.yaml');

      writeFileSync(escapedFile, 'original');
      symlinkSync(escapedFile, symlinkPath);

      const mod = makeModule({ moduleId: 'escape' });
      const writer = new YAMLWriter();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const results = writer.write([mod], outputDir);

      expect(results).toHaveLength(1);
      expect(results[0].verified).toBe(false);
      expect(results[0].verificationError).toContain('symlink');

      warnSpy.mockRestore();
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(escapeDir, { recursive: true, force: true });
    });
  });
});
