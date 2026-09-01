# Changelog

All notable changes to this project will be documented in this file.

## [0.10.2] - 2026-09-01

Patch release. Bumps the required `apcore-js` floor to `0.28.0`. The 0.28.0 release is scoped entirely to the ACL/Executor governance layer (argument-scoped approval, `ACL.defaultEffect`/`rules` accessors, `ACL.validateRules()`, `ExecutionPolicy.resolve()` call-site parameters, `Executor.governanceState()`) — none of it touches `Registry`, `FunctionModule`, `jsonSchemaToTypeBox`, or module annotations, which is all this toolkit uses (confirmed via grep). No code or API changes; all 617 tests pass unmodified against apcore-js 0.28.0.

## [0.10.1] - 2026-07-14

Patch release. Bumps the required `apcore-js` floor to `0.26.0` to align the ecosystem on the 0.26.0 governance layer (Execution Policy, governance events, no-handler fail-loud — additive, no breaking changes). No code or API changes.

## [0.10.0] - 2026-07-07

Cross-language parity with the Python toolkit: ship the reusable annotation-preservation conformance verifier. (The dropped-annotations bug that motivated this existed only in two Python adapters; `nestjs-apcore` and this toolkit's writers already preserve annotations — verified. This adds the guard so a future TS adapter can't silently regress.) All 617 tests pass.

### Added

- **`assertAnnotationsPreserved(writer, scannedModule, registry, fields?)`** (`src/conformance.ts`, exported from the package root) — a framework-agnostic verifier (throws on failure) that registers a module and asserts its behavioral annotations survive `registry.getDefinition`. Adapters import it into their own test suites so a dropped-annotations regression fails loudly. Defaults to checking `requiresApproval` / `destructive`. Covered by `tests/conformance.test.ts` (passes for the base writer using a **real** `Registry`, throws for a writer that drops annotations). Mirrors `apcore_toolkit.conformance.assert_annotations_preserved` in Python.

## [0.9.0] - 2026-06-23

Minor release. Fixes registry verification and async registration against the real apcore Registry. No public API changes; all 614 tests pass.

### Fixed

- **`RegistryVerifier` called `getModule()`, which apcore's `Registry` does not have** — apcore-js exposes `get(id)` (matching apcore-python's `registry.get()` and apcore-rust's `registry.has()`); there is no `getModule`. As a result, `RegistryWriter.write(..., { verify: true })` against a real `Registry` always reported every module as unverified. The verifier now calls `get(id)`. Existing tests passed only because they mocked a `{ getModule }` registry, masking the mismatch — those mocks are updated. (`output/verify-core.ts`)
- **`RegistryWriter.write` did not `await` `registry.register()`** — apcore's `register()` returns `Promise<void>` and surfaces async `onLoad` / async-validator failures as a rejected promise. The unawaited call let those escape the `try/catch` as an unhandled rejection (which can crash Node) and ran verification before a deferred-publish `onLoad` had resolved. The call is now awaited. (`output/registry-writer.ts`)


## [0.8.1] - 2026-06-12

Patch release. Bumps the required apcore runtime floor to 0.24.0. Toolkit API surface and code unchanged; all 603 tests pass without modification against 0.24.0.

### Changed

- Required runtime bumped to `apcore-js>=0.24.0` — bumped from `>=0.22.0`. Toolkit's stable surface is unaffected by the 0.22 → 0.24 delta.

  Key 0.23.0–0.24.0 changes visible to toolkit users (indirect runtime effects):
  - `Registry.unregister()` now correctly clears hot-reload/drain state (A-D-001) — re-registering after a direct `unregister()` no longer throws `ModuleNotFoundError`. Toolkit's `RegistryWriter.write()` calls `register` only, but callers who manually `unregister()` between `write()` calls benefit.
  - Sensitive-key (`_secret_*`) redaction now recurses into array elements (A-D-003). Modules with sensitive keys inside nested array values are now properly redacted in apcore logs.
  - `CALL_DEPTH_EXCEEDED` / `CIRCULAR_CALL` / `CALL_FREQUENCY_EXCEEDED` error `details` keys are now `snake_case` (A-D-019) — affects callers parsing `error.details` directly.
  - `CircuitBreakerMiddleware` constructor is breaking in 0.23.0 (old `failure_threshold`/`success_threshold` removed). Toolkit does not use this middleware; no toolkit changes required.
  - AI error-recovery metadata (`userFixable`, `aiGuidance`) is now auto-populated on `ModuleError` at the framework level (0.23.0).

## [0.8.0] - 2026-05-28

Aligned release across Python, TypeScript, and Rust. Bumps the required apcore runtime to 0.22.0.

### Changed

- Required runtime bumped to `apcore-js 0.22.0` — bumped from `>=0.21.0`. Toolkit API surface unchanged; all 603 tests pass without code changes against 0.22.0.

  Key 0.22.0 changes visible to toolkit users:
  - `Registry.register()` now rejects the second concurrent caller with `InvalidInputError(code=DUPLICATE_MODULE_ID)` immediately. `RegistryWriter.write()` registers sequentially and is unaffected under normal usage.
  - Registration Ordering Invariants: modules are now guaranteed fully visible to `registry.get()` / `registry.list()` immediately on return from `write()`.
  - `StreamingModule` promoted from duck-typed to explicit interface — `RegistryWriter._toFunctionModule` creates a `StreamingFunctionModule` adapter for targets with an async `stream()` method.

## [0.7.0] - 2026-05-12

### Fixed (post-audit cross-SDK reconciliation)

- **`RegistryWriter._toFunctionModule` no longer strips `display`.** The resolved display lives in `metadata["display"]` (per `DisplayResolver`); the previous strip-display branch dropped it on the floor when round-tripping through the registry. Now `metadata` is passed through unchanged. Aligns with Python and Rust SDK behavior. (D11-001)
- **`RegistryWriter._toFunctionModule` — empty-collection normalization.** Empty `tags` / `metadata` / `examples` are no longer coerced to `null`. Canonical cross-SDK rule: keep empty collections as `[]` / `{}` and reserve `null` for unset. Matches Python (post-fix) and Rust behavior. (D11-007)
- **`DisplayResolver._loadBindingFiles` no longer skips symlinks.** Python and Rust DisplayResolvers follow symlinks transparently, and TS's own `BindingLoader` already does too. Removed the `lstatSync` symlink-skip block for cross-SDK parity. The corresponding regression test was inverted to assert symlinked binding files are loaded. (D10-W1)
- **`DisplayResolver._resolveOne` — empty-string fallback alignment.** `??` chains on `documentation` and `guidance` (default and per-surface) now use `||` so that empty-string `guidance` falls through to the resolved default. Matches Python's `or` semantics and Rust's `str_or` filter. (D11-003)

### Added

- **`tests/display-resolve-conformance.test.ts`** — new cross-SDK conformance test wired to the shared fixture `apcore-toolkit/conformance/fixtures/display_resolve.json` (14 cases). Previously orphaned across all three SDKs. (D9-W1)

### Changed

- Annotated the `createWriteResult` export in `src/index.ts` as a TS-only ergonomic helper. Python and Rust callers construct `WriteResult` directly via dataclass/struct literals; the annotation documents the deliberate parity gap. (D1-W1)
- Lowered the `apcore-js` runtime dep floor from `>=0.21.1` to `>=0.21.0` to align with the Python and Rust SDKs (which target `apcore 0.21.x` on PyPI / crates.io, where 0.21.1 is not published). (D3-W1, corrected direction)

### Added

- **`formatCsv(rows, options?)` and `formatJsonl(rows)`** — byte-equivalent tabular data formatters. Lives in `src/formatting/tabular.ts`; re-exported from the package root. Cross-SDK byte-identity contract: Python / TypeScript / Rust SDKs emit identical bytes for the same input. Asserted via shared conformance corpus at `apcore-toolkit/conformance/fixtures/`.
- **`FormatCsvOptions`** type exposing the `bom` flag for Excel-locale users.

### CSV / JSONL canonical contract

- **CSV**: header = union of keys across all rows in insertion-order (fixes apcore-cli-typescript heterogeneous-keys data-loss bug at `src/output.ts:347-354`). Non-scalar cells = `JSON.stringify(value)`. RFC 4180 CRLF terminator. `,` / `"` / `\n` / `\r` quote-wrapped, embedded `"` doubled.
- **JSONL**: canonical compact `JSON.stringify` per row, LF terminator, no trailing blank.
- **Numbers**: NaN/Infinity collapse to empty CSV cell / JSON `null` (matching JS default). Insertion-order keys preserved via JS object property ordering.

### Why

Per-SDK reimplementations of csv/jsonl had accumulated divergence. The spec MUST language couldn't enforce conformance on downstream consumers (e.g. aisee-cli) that reimplemented their own emission. See `apcore-cli/docs/tech-design.md` ADR-09 for the tier-split rationale.

### Notes

- **YAML is intentionally not in this tier yet.** Each idiomatic YAML library (PyYAML, js-yaml, serde_yaml_ng) emits different forms even for identical input. Byte-equivalence requires a custom emitter, which is deferred. YAML remains SDK-native (Tier 2) and may differ across languages.
- Integers exceeding `Number.MAX_SAFE_INTEGER` (`2^53 - 1`) are not portable across SDKs; callers should serialize them as JSON strings.

### Cross-SDK reconciliation (post-audit, no TypeScript code change)

The 2026-05-12 cross-SDK audit (`/apcore-skills:audit --scope toolkit`) reconciled spec text and implementations across the three toolkit SDKs. The TypeScript surface is unchanged in 0.7.0 beyond the tabular formatters above — the audit found TypeScript already implemented the canonical behaviour for the relevant contracts. Spec updates that now formally guarantee TypeScript behaviour cross-SDK:

- **`getWriter` HTTP-proxy aliases** (D10-003) — `getWriter("http_proxy", { baseUrl })` and `getWriter("httpproxy", { baseUrl })` were already accepted by the TypeScript factory (Issue #5). The 0.7.0 release elevates this to a cross-SDK guarantee: `apcore-toolkit-python` 0.7.0 now also accepts the aliases. Spec: `apcore-toolkit/docs/features/output-writers.md` § Contract: get_writer.
- **`resolveRef` prototype-pollution guard** (D10-004) — TypeScript's `PROTO_DENY_LIST` (blocks `__proto__` / `constructor` / `prototype` JSON-pointer segments) is now formally documented in `apcore-toolkit/docs/features/openapi.md` as a TypeScript-only language-specific hardening. Behaviour unchanged.
- **`format_module` / `format_modules` error contract** (D10-005) — spec now declares that the `Err(FormatError)` text in `format_module` / `format_modules` documents the Rust enum behaviour; the Python `Error` and TypeScript `Error` raised on unknown style values continue to apply. No TypeScript change.
- **`DisplayResolver.resolve` error contract** (D10-006) — spec narrowed the `### Errors` block to "MCP alias validation only", matching the warn-and-continue behaviour TypeScript already implements for invalid `binding_data` shape. No TypeScript change.
- **`apcore-toolkit-rust` error rename** (D1-001) — Rust renamed `OutputFormatError` to `InvalidFormatError` for symbol parity with TypeScript's existing `InvalidFormatError`. TypeScript surface unchanged; cross-language porting is now grep-aligned.

### Test suite

- 588 tests pass (unchanged from baseline). No new tests added — TypeScript behaviour is unchanged by this reconciliation pass.

## [0.6.1] - 2026-05-09

### Changed

- **`apcore-js` minimum version bumped from 0.21.0 to 0.21.1** —
  `package.json` `dependencies` now requires `apcore-js >=0.21.1`.
  Picks up the apcore-js 0.21.1 fix for the Bun init-time deadlock
  caused by top-level `await import('node:*')` chains. Toolkit's own
  imports from apcore-js are unchanged (still pure types + browser-
  safe helpers); 25 vitest test files / 541 tests pass against
  apcore-js 0.21.1.


## [0.6.0] - 2026-05-07

### Changed

- **`apcore-js` minimum version bumped from 0.20.0 to 0.21.0** — `package.json` `dependencies` now requires `apcore-js >=0.21.0`. Toolkit only imports stable apcore-js surface (`ModuleAnnotations`, `DEFAULT_ANNOTATIONS`, `ModuleExample`, `Context`, `FunctionModule`, `jsonSchemaToTypeBox`, `annotationsFromJSON`, `annotationsToJSON`); the 0.21.0 additions (`discoverable` field on `ModuleAnnotations`, `PreviewResult`, `Change`, `ephemeral.*` namespace) are automatically handled — `annotationsFromJSON` / `annotationsToJSON` already serialize `discoverable`, and `inferAnnotationsFromMethod` spreads `DEFAULT_ANNOTATIONS` so the new field propagates without code changes. `AIEnhancer` derives its annotation field set from `Object.entries(DEFAULT_ANNOTATIONS)` at load time, so it also picks up `discoverable` automatically. Full vitest suite + `tsc --noEmit` verified against apcore-js 0.21.0.
- **`apcore-js` minimum version bumped from 0.19.0 to 0.20.0** — `package.json` `dependencies` now requires `apcore-js >=0.20.0`; `pnpm-lock.yaml` regenerated to `apcore-js@0.20.0`. Toolkit only imports stable apcore-js surface (`ModuleAnnotations`, `DEFAULT_ANNOTATIONS`, `ModuleExample`, `Context`, `FunctionModule`, `jsonSchemaToTypeBox`, `annotationsFromJSON`, `annotationsToJSON`); none of these were affected by 0.20.0 changes. Full vitest suite (490 passed) + `tsc --noEmit` clean against apcore-js 0.20.0.

### Added

- **Surface-aware formatters** (refs aiperceivable/apcore-toolkit#13) — `formatModule`, `formatSchema`, `formatModules` for rendering `ScannedModule` and JSON Schema for specific consumer surfaces. Four styles for `formatModule`: `markdown` (LLM context), `skill` (drop-in `.claude/skills/<id>/SKILL.md` or `.gemini/skills/<id>/SKILL.md` body with minimal `name` + `description` frontmatter — no vendor-specific extensions), `table-row` (CLI listing), `json` (programmatic). `formatSchema` styles: `prose`, `table`, `json`. `formatModules` adds optional `groupBy: "tag" | "prefix"`. `display: true` (default) prefers the `ScannedModule.display` overlay over raw fields. Lives in `src/formatting/surface.ts`; re-exported from the top-level package.
- **Annotation-table cross-SDK alignment** — `formatModule({style: "markdown" | "skill"})` `## Behavior` table now emits only fields that differ from `DEFAULT_ANNOTATIONS`, sorts rows alphabetically by snake_case key, and renders bool values as lowercase `true`/`false`. The section is omitted entirely when every annotation field matches its default. Closes the byte-equality gap with the Python and Rust SDKs.

### Changed

- **`inferAnnotationsFromMethod` canonical mapping** (refs aiperceivable/apcore-toolkit#11) — `HEAD` and `OPTIONS` now map to `readonly=true` (without `cacheable=true`), matching the canonical mapping declared in `apcore-toolkit/docs/features/scanning.md` and aligning with the existing Rust SDK. Previously these methods returned default annotations.

## [0.5.1] - 2026-04-30

### Fixed

- **`package.json` `preinstall` hook removed** — the `npx only-allow pnpm` script was a development-time guardrail that also fired when downstream consumers installed `apcore-toolkit` as a dependency via npm or yarn, causing their installs to fail. The hook has been removed from the published package; pnpm enforcement remains in the monorepo root for internal development.

## [0.5.0] - 2026-04-21

### Added

- **`BindingLoader`** / **`BindingLoadError`** — parses `.binding.yaml` files back into `ScannedModule` objects (inverse of `YAMLWriter`). Pure-data reader: no target resolution, no Registry side effects. Matches the Python and Rust implementations in API shape and behaviour.
  - `load(path, options?)` — single file or directory of `*.binding.yaml`.
  - `loadData(data, options?)` — pre-parsed YAML data.
  - Loose mode (default): only `module_id + target` required.
  - Strict mode (`{ strict: true }`): additionally requires `input_schema + output_schema`.
  - `spec_version` validated; missing or unsupported values emit a `console.warn` but do not throw.
  - `annotations` parsed via `annotationsFromJSON` from `apcore-js`; malformed values degrade to `null` with a warning.
  - `BindingLoadError.filePath`, `moduleId`, `missingFields`, and `reason` fields exposed for programmatic handling.
- **`ScannedModule.display`** — new readonly field (`Record<string, unknown> | null`) for the sparse display overlay. `createScannedModule` factory and `cloneModule` helper updated; deep-cloned on read and write.

### Changed

- **`YAMLWriter._buildBinding`** — emits top-level `display:` key only when `module.display !== null`.
- **`serializers.moduleToDict`** — includes `display` key (deep-cloned).

### Dependencies

- **`apcore-js >= 0.19.0`** — picks up the 12-field `ModuleAnnotations` and `annotationsFromJSON`. No toolkit changes required for annotations semantics.

### Tests

- +29 new tests: 23 for `BindingLoader` (parsing, strict/loose modes, filesystem loading, round-trip), 4 for `display` field emission/serialization, and 2 hardening tests (malformed display/schema warning). Total suite: 320 tests.

### Hardening (post-review)

- **`BindingLoader`**: `_asRecord` / `_asRecordOrNull` now warn when given a non-mapping value (previously silent). `_parseExamples` uses `structuredClone` on each entry so caller mutation of the returned `ScannedModule.examples` cannot leak into the YAML parser's object graph. `fs.statSync` failures are inspected for `ENOENT`/other `errno` codes so users see a specific error instead of a generic "path does not exist" for permission issues.

### Hardening (cross-SDK sync — post-audit)

- **`BindingLoader` strict-mode wrong-type rejection** — a required field is now rejected when absent, `null`, or of the wrong type (e.g. `module_id: 42`, `target: true`, empty-string `module_id`). Previously TypeScript silently coerced wrong-type scalars via `String(value)`, while Rust already rejected them; the same YAML now behaves identically in all three SDKs. The error reason widens from `"missing required fields"` to **`"missing or invalid required fields"`**, matching the Rust loader.
- **`BindingLoader._asRecord` defensive deep-copy** — previously returned a fresh outer `{}` but shared nested refs with the parsed YAML source graph. Now `structuredClone`s the filtered result so caller mutation of `ScannedModule.inputSchema`/`outputSchema`/`metadata` does not leak back into the YAML parser's object graph (defensive parity with the Python `copy.deepcopy` and Rust `Value.clone` loaders).

### Removed

- **`flattenParams`** — removed from README (Features list and API table). The symbol was advertised there but never exported from `src/index.ts`; the canonical docs previously described it as a TypeScript utility for "flattening Zod schemas", but TypeScript's native object-argument idiom (`function createUser(body: { username, email })`) already accepts flat inputs, making the wrapper a no-op. Users who need to iterate a Zod schema's fields at runtime can do so directly via `Object.keys(schema.shape)`. The Python `flatten_pydantic_params` remains and continues to serve Python's Pydantic-model unwrapping use-case.

### Added (browser / edge runtime subpath)

- **`apcore-toolkit/browser`** — new subpath export that exposes the runtime-neutral subset of the toolkit. Intended for consumers that bundle apcore-toolkit into a browser, edge runtime, or worker environment (e.g. `tiptap-apcore`). The default entry point continues to re-export the full Node-capable surface unchanged — this subpath is strictly additive; existing consumers (`nestjs-apcore` et al.) see zero API changes.
  - Exposes: `ScannedModule` / `createScannedModule` / `cloneModule`, `BaseScanner`, the HTTP verb mapping helpers, `enrichSchemaDescriptions`, the OpenAPI resolvers (`resolveRef` / `resolveSchema` / `deepResolveRefs` / `extractInputSchema` / `extractOutputSchema`), the serializers (`annotationsToDict` / `moduleToDict` / `modulesToDicts`), `toMarkdown`, `BindingParser` / `parseBindingDocument` / `BindingLoadError`, the write-pipeline types (`WriteResult` / `VerifyResult` / `Verifier` / `createWriteResult` / `WriteError` / `InvalidFormatError`), `RegistryVerifier` / `runVerifierChain`, and `HTTPProxyRegistryWriter` / `HTTPProxyRegistryWriterError`.
  - Excludes (Node-only): `YAMLWriter`, `TypeScriptWriter`, `RegistryWriter`, `getWriter`, `BindingLoader` (the fs-reading subclass — use `BindingParser` instead), `DisplayResolver`, `AIEnhancer`, `resolveTarget`, the file-based verifiers (`YAMLVerifier`, `SyntaxVerifier`, `MagicBytesVerifier`, `JSONVerifier`), and `VERSION`. These touch `node:fs` / `node:path` / `node:module` / `process.*` and cannot be safely bundled for browsers.
- **`BindingParser`** — new class at `src/binding-parser.ts` that owns the runtime-neutral binding document parsing logic. `BindingLoader` is now a subclass that adds `load(filePath)` for filesystem loading. `BindingLoader.loadData(data)` continues to work unchanged (inherited). Mirrors the `load_data` split available on the Python `BindingLoader` class.
- **`parseBindingDocument(raw, options?, filePath?)`** — standalone function form of `BindingParser.loadData`, with an optional explicit `filePath` for richer `BindingLoadError` messages when the document came from a known file location.
- **`HTTPProxyRegistryWriter` documented in README API table** — previously shipped but undocumented. Uses only global `fetch` / `AbortController` / `URLSearchParams`; runs in any modern runtime.

### Internal restructuring (no public API change)

- **`src/output/verifiers.ts` split** — the runtime-neutral `RegistryVerifier` class and `runVerifierChain` function moved to a new `src/output/verify-core.ts`. `verifiers.ts` still re-exports them, so all existing imports (`nestjs-apcore`, the default package entry, internal consumers like `registry-writer.ts` and `base-writer.ts`) continue to resolve the same symbols from the same path. The split lets `apcore-toolkit/browser` import directly from `verify-core.ts` without pulling in the file-based verifiers' `node:fs` / `node:module` dependencies.
- **`src/binding-loader.ts` split** — the class hierarchy is now `BindingLoader extends BindingParser`, with the pure parsing primitives and error / options types relocated to `src/binding-parser.ts`. `BindingLoader` retains its `load(filePath)` method and re-exports `BindingParser`, `parseBindingDocument`, `BindingLoadError`, and `BindingLoadOptions` so all existing import paths keep working.

### Tests

- +3 new tests in `tests/browser-entry.test.ts`:
  1. The expected 30-symbol browser-safe surface is actually exported.
  2. Node-only symbols (`YAMLWriter`, `BindingLoader`, `AIEnhancer`, `VERSION`, et al.) are **not** leaked into the subpath.
  3. Static import-graph walker starts at `src/browser/index.ts` and recursively reads every relative import; fails if any file in the transitive graph references `node:*`, a bare Node builtin, `process.*`, or `createRequire`. This is the regression guard — any future change that accidentally pulls a Node dependency into the browser subpath will be blocked in CI.
- Full suite: **457 tests across 22 files, all passing.**

## [0.4.0] - 2026-03-25

### Added

- **`DisplayResolver`** — sparse `binding.yaml` overlay that resolves surface-facing alias, description, guidance, tags, and documentation into `metadata["display"]` for CLI, MCP, and A2A consumers. Ported from Python with full feature parity.
  - Resolution chain: surface-specific override > `display` default > binding-level field > scanner value.
  - MCP alias auto-sanitization and 64-char limit enforcement.
  - CLI alias validation with fallback on pattern mismatch.
  - `suggested_alias` fallback from `ScannedModule.metadata`.
  - Match-count logging via `console.info`/`console.warn`.
  - Supports single YAML files, directories of `*.binding.yaml` files, and pre-parsed data.

## [0.3.1] - 2026-03-22

### Changed
- Rebrand: aipartnerup → aiperceivable

## [0.3.0] - 2026-03-19

### Added

- `deepResolveRefs()` — recursive `$ref` resolution for nested OpenAPI schemas,
  handling `allOf`/`anyOf`/`oneOf`, `items`, and `properties`. Depth-limited to 16
  levels to prevent infinite recursion on circular references. Exported from
  package index for downstream use.
- `Enhancer` interface — pluggable contract for metadata enhancement, allowing
  custom enhancers beyond the built-in `AIEnhancer`.

### Fixed

- `extractOutputSchema()` — now recursively resolves all nested `$ref` pointers
  via `deepResolveRefs` (previously only handled the shallow case of array items
  with `$ref`).
- `extractInputSchema()` — now recursively resolves `$ref` inside individual
  properties after assembly (was missing entirely).
- `WriteError.cause` — explicit typed `override readonly cause: Error` property,
  narrowing from the base `unknown` type.

### Tests

- 182 tests (up from 171), all passing
- Added `deepResolveRefs` test suite (8 tests): top-level ref, nested properties,
  allOf/anyOf, array items, deeply nested refs, circular ref depth limit,
  immutability guarantee
- Added nested `$ref` tests for `extractInputSchema` and `extractOutputSchema`
- Shared `OPENAPI_DOC` fixture with rich schema graph for all openapi tests

---

## [0.2.0] - 2026-03-12

### Added

- `AIEnhancer` class — SLM-based metadata enhancement using OpenAI-compatible
  APIs (Ollama, vLLM, LM Studio). Fills missing descriptions, infers behavioral
  annotations (all 11 fields: `readonly`, `destructive`, `idempotent`,
  `requires_approval`, `open_world`, `streaming`, `cacheable`, `cache_ttl`,
  `cache_key_fields`, `paginated`, `pagination_style`), and generates input
  schemas. AI-generated fields tagged with `x-generated-by: slm` for auditability.
- `createWriteResult()` factory and `runVerifierChain()` helper for writer operations.
  `verify: true` runs the built-in verifier (`YAMLVerifier`, `SyntaxVerifier`,
  `RegistryVerifier`) even when no custom `verifiers` are provided.
- `allowedPrefixes` parameter on `resolveTarget()` for path restriction security

### Fixed

- `inferAnnotationsFromMethod()` — `GET` now infers `cacheable: true` in addition
  to `readonly: true`, matching Python parity
- `filterModules()` — use `safeRegExp()` that tries regex first and falls back
  to escaped literal on invalid patterns (balances spec compliance with safety)
- `YAMLWriter._buildBinding()` — use `structuredClone()` for deep cloning nested
  schemas instead of shallow spread
- `WriteError` — use native ES2022 `Error.cause` instead of shadowing the property
- `JSONVerifier` — restored `schema` constructor parameter for cross-language
  API parity with Python SDK

### Tests

- 171 tests across 14 files, all passing
- Added `RegistryVerifier` test coverage (pass, fail, missing method)
- Added `resolveTarget` allowedPrefixes tests
- Full AIEnhancer test suite (15 tests)

---

## [0.1.0] - 2026-03-07

### Added

- `ScannedModule` interface — canonical representation of a scanned endpoint
- `BaseScanner` abstract class with filtering, deduplication, and annotation inference
- `enrichSchemaDescriptions()` — merge parameter descriptions into JSON Schema
- OpenAPI utilities: `resolveRef`, `resolveSchema`, `extractInputSchema`, `extractOutputSchema`
- Serializers: `annotationsToDict`, `moduleToDict`, `modulesToDicts`
- `toMarkdown()` — generic dict-to-Markdown conversion with depth control and table heuristics
- `YAMLWriter` — generate `.binding.yaml` files for `BindingLoader`
- `TypeScriptWriter` — generate TypeScript wrapper files with `module()` decorator
- `RegistryWriter` — direct registration into `apcore-js` Registry
- `getWriter()` factory function
- `resolveTarget()` — dynamic import resolution for `module:export` target strings
