// Browser-safe subset of apcore-toolkit.
//
// This entry point exposes only the symbols whose module load and runtime
// behavior do not depend on any Node.js built-in (`node:fs`, `node:path`,
// `node:module`, `process.*`). It is intended for consumers that bundle
// apcore-toolkit into a browser, edge runtime, or worker environment —
// e.g. tiptap-apcore.
//
// The default entry point (`apcore-toolkit`) continues to re-export the full
// Node-capable surface (file writers / readers, binding loader, display
// resolver, file verifiers, AI enhancer, VERSION) for tri-SDK parity with
// the Python and Rust toolkits. Do not add Node-only symbols here without
// an environment guard; doing so defeats the purpose of this subpath. A
// static check in `tests/browser-entry.test.ts` walks the transitive
// import graph from this file and fails if any Node-only reference leaks
// in.

// ---- Core types & scanned-module utilities (pure) -------------------------
export type { ScannedModule } from '../types.js';
export { createScannedModule, cloneModule } from '../types.js';

export { BaseScanner } from '../scanner.js';

// ---- HTTP verb mapping (pure) --------------------------------------------
export {
  SCANNER_VERB_MAP,
  hasPathParams,
  resolveHttpVerb,
  generateSuggestedAlias,
  extractPathParamNames,
  substitutePathParams,
} from '../http-verb-map.js';

// ---- Schema / OpenAPI utilities (pure) -----------------------------------
export { enrichSchemaDescriptions } from '../schema-utils.js';
export {
  resolveRef,
  resolveSchema,
  deepResolveRefs,
  extractInputSchema,
  extractOutputSchema,
} from '../openapi.js';

// ---- Serializers & formatting (pure) -------------------------------------
export {
  annotationsToDict,
  moduleToDict,
  modulesToDicts,
} from '../serializers.js';

export { toMarkdown } from '../formatting/index.js';

// ---- Binding parsing (runtime-neutral half of BindingLoader) -------------
// `BindingLoader` itself stays Node-only (reads from disk). `BindingParser`
// is the superclass that owns the pure parsing logic; `parseBindingDocument`
// is the equivalent standalone function. Browser callers typically fetch a
// binding document then hand it off to one of these.
export {
  BindingParser,
  BindingLoadError,
  parseBindingDocument,
} from '../binding-parser.js';
export type { BindingLoadOptions } from '../binding-parser.js';

// ---- Write-pipeline types & errors (pure) --------------------------------
// Useful for browser callers that define custom writers/verifiers or
// consume `WriteResult[]` returned by `HTTPProxyRegistryWriter`.
export type { WriteResult, VerifyResult, Verifier } from '../output/types.js';
export { createWriteResult } from '../output/types.js';
export { WriteError, InvalidFormatError } from '../output/errors.js';

// ---- Runtime-neutral verifier primitives (pure) --------------------------
// File-based verifiers (`YAMLVerifier`, `SyntaxVerifier`, `MagicBytesVerifier`,
// `JSONVerifier`) live in `output/verifiers.ts` and stay Node-only because
// they read files off disk.
export { RegistryVerifier, runVerifierChain } from '../output/verify-core.js';

// ---- HTTP proxy writer (uses global fetch / AbortController, no Node APIs)
// Registers `ScannedModule[]` as HTTP-proxied modules in an in-memory
// registry — each module's `execute()` forwards inputs to a backend URL.
// Works in any environment where `fetch` is available (Node 20+, browsers,
// Deno, workers).
export {
  HTTPProxyRegistryWriter,
  HTTPProxyWriterError,
} from '../output/http-proxy-writer.js';
export type {
  HTTPProxyRegistryWriterOptions,
  ProxyRegistry,
} from '../output/http-proxy-writer.js';
