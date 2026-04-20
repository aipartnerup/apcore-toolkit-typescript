// Real-filesystem tests for TypeScriptWriter symlink escape protection (D2-symlink)
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScannedModule } from '../src/types.js';
import { TypeScriptWriter } from '../src/output/typescript-writer.js';

function makeModule(overrides: Record<string, unknown> = {}) {
  return createScannedModule({
    moduleId: 'symlink_mod',
    description: 'test',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    tags: [],
    target: 'mod:fn',
    ...overrides,
  } as Parameters<typeof createScannedModule>[0]);
}

describe('TypeScriptWriter — symlink escape protection', () => {
  it('blocks write when output file is a symlink pointing outside outputDir', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'ts-writer-symlink-'));
    const escapeDir = mkdtempSync(join(tmpdir(), 'ts-writer-escape-'));
    const escapedFile = join(escapeDir, 'symlink_mod.ts');
    const symlinkPath = join(outputDir, 'symlink_mod.ts');

    writeFileSync(escapedFile, '// original content');
    symlinkSync(escapedFile, symlinkPath);

    const writer = new TypeScriptWriter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writer.write([makeModule()], outputDir);

    expect(readFileSync(escapedFile, 'utf-8')).toBe('// original content');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping'),
      expect.any(String),
    );

    warnSpy.mockRestore();
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(escapeDir, { recursive: true, force: true });
  });
});
