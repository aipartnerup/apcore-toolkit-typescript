# Changelog

## [0.5.0] - 2026-04-19

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
