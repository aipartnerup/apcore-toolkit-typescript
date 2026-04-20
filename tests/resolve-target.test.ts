import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget } from "../src/resolve-target";

describe("resolveTarget", () => {
  it("rejects target without ':' — throws with 'Invalid target format'", async () => {
    await expect(resolveTarget("no-colon-here")).rejects.toThrow(
      'Invalid target format: "no-colon-here". Expected "module/path:exportName".',
    );
  });

  it("resolves a valid Node.js built-in: 'node:path:join' returns the join function", async () => {
    const result = await resolveTarget("node:path:join");
    const { join } = await import("node:path");
    expect(result).toBe(join);
  });

  it("resolves 'node:fs:existsSync' — returns a function", async () => {
    const result = await resolveTarget("node:fs:existsSync");
    expect(typeof result).toBe("function");
  });

  it("throws for nonexistent module: 'nonexistent-module-xyz:foo'", async () => {
    await expect(resolveTarget("nonexistent-module-xyz:foo")).rejects.toThrow(
      'Failed to import module "nonexistent-module-xyz"',
    );
  });

  it("throws for nonexistent export: 'node:path:nonExistentExport'", async () => {
    await expect(resolveTarget("node:path:nonExistentExport")).rejects.toThrow(
      'Export "nonExistentExport" not found in module "node:path"',
    );
  });

  it("rejects file-path imports outside allowed prefixes", async () => {
    await expect(
      resolveTarget("/etc/passwd:default", ["/usr/src/app"]),
    ).rejects.toThrow("not under any allowed prefix");
  });

  it("allows node: imports when no allowedPrefixes are set", async () => {
    const result = await resolveTarget("node:path:join");
    expect(typeof result).toBe("function");
  });

  it("blocks node: built-in imports when allowedPrefixes are set (sandbox bypass prevention)", async () => {
    await expect(
      resolveTarget("node:path:join", ["/some/prefix"]),
    ).rejects.toThrow("only file-path imports are permitted");
  });

  it("rejects sibling-name path that shares a prefix but is NOT a child (D2-2 regression)", async () => {
    // /foobar/secret.js starts with /foo but is NOT under /foo/ — must be rejected
    await expect(
      resolveTarget("/foobar/secret.js:default", ["/foo"]),
    ).rejects.toThrow("not under any allowed prefix");
  });

  it("rejects a symlink inside an allowed prefix that points outside (D2-4 regression)", async () => {
    const safeDir = mkdtempSync(join(tmpdir(), "resolve-safe-"));
    const dangerDir = mkdtempSync(join(tmpdir(), "resolve-danger-"));
    const dangerFile = join(dangerDir, "secret.mjs");
    writeFileSync(dangerFile, "export default 42;\n", "utf-8");
    const symlink = join(safeDir, "link.mjs");
    symlinkSync(dangerFile, symlink);

    try {
      await expect(
        resolveTarget(`${symlink}:default`, [safeDir]),
      ).rejects.toThrow("not under any allowed prefix");
    } finally {
      rmSync(safeDir, { recursive: true, force: true });
      rmSync(dangerDir, { recursive: true, force: true });
    }
  });
});
