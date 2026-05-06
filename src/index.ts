export type { ScannedModule } from './types.js';
export { createScannedModule, cloneModule } from './types.js';

// Tri-language parity note
// ------------------------
// The Python SDK exports `ConventionScanner`, a pydantic-specific scanner that
// walks `BaseModel` subclasses for endpoint metadata. It is intentionally
// Python-only: the pydantic conventions it relies on do not have TypeScript
// equivalents. Rust mirrors this decision (see
// apcore-toolkit-rust/src/scanner.rs for the same note).

export { BaseScanner } from './scanner.js';
export {
  SCANNER_VERB_MAP,
  hasPathParams,
  resolveHttpVerb,
  generateSuggestedAlias,
  extractPathParamNames,
  substitutePathParams,
} from './http-verb-map.js';
export { enrichSchemaDescriptions } from './schema-utils.js';
export {
  resolveRef,
  resolveSchema,
  deepResolveRefs,
  extractInputSchema,
  extractOutputSchema,
} from './openapi.js';
export {
  annotationsToDict,
  moduleToDict,
  modulesToDicts,
} from './serializers.js';
export { resolveTarget } from './resolve-target.js';
export { toMarkdown } from './formatting/index.js';
export { AIEnhancer } from './ai-enhancer.js';
export type { AIEnhancerOptions, Enhancer } from './ai-enhancer.js';
export { DisplayResolver } from './display/resolver.js';
export type {
  DisplayResolveOptions,
  DisplayMetadata,
  SurfaceDisplay,
} from './display/resolver.js';
export { BindingLoader, BindingLoadError } from './binding-loader.js';
export type { BindingLoadOptions } from './binding-loader.js';
export { YAMLWriter } from './output/yaml-writer.js';
export { TypeScriptWriter } from './output/typescript-writer.js';
export { RegistryWriter } from './output/registry-writer.js';
export {
  HTTPProxyRegistryWriter,
  HTTPProxyWriterError,
} from './output/http-proxy-writer.js';
export type {
  HTTPProxyRegistryWriterOptions,
  ProxyRegistry,
} from './output/http-proxy-writer.js';
export { getWriter } from './output/factory.js';
export type { WriteResult, VerifyResult, Verifier } from './output/types.js';
export { WriteError, InvalidFormatError } from './output/errors.js';
export {
  YAMLVerifier,
  SyntaxVerifier,
  RegistryVerifier,
  MagicBytesVerifier,
  JSONVerifier,
  runVerifierChain,
} from './output/verifiers.js';

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION: string = _pkg.version;

// Issue #6 [D1-001]: Package-level free-function exports for cross-language parity.
// Python and Rust expose these as package-level symbols; TypeScript previously
// only exposed them as BaseScanner instance/static methods.
import { BaseScanner as _BaseScanner } from './scanner.js';
import type { ModuleAnnotations } from 'apcore-js';

/**
 * Apply include/exclude regex filters to a list of scanned modules.
 * Package-level free function; delegates to BaseScanner.filterModules.
 */
export function filterModules(
  modules: import('./types.js').ScannedModule[],
  include?: string,
  exclude?: string,
): import('./types.js').ScannedModule[] {
  return _scanner.filterModules(modules, include, exclude);
}

/**
 * Deduplicate module IDs by appending a numeric suffix to colliding entries.
 * Package-level free function; delegates to BaseScanner.deduplicateIds.
 */
export function deduplicateIds(
  modules: import('./types.js').ScannedModule[],
): import('./types.js').ScannedModule[] {
  return _scanner.deduplicateIds(modules);
}

/**
 * Infer behavioral annotations from an HTTP method string.
 * Package-level free function; delegates to BaseScanner.inferAnnotationsFromMethod.
 */
export function inferAnnotationsFromMethod(method: string): ModuleAnnotations {
  return _BaseScanner.inferAnnotationsFromMethod(method);
}

// Shared scanner instance used only for the free-function wrappers above.
// We need a concrete subclass because BaseScanner is abstract.
const _scanner = new (class extends _BaseScanner {
  scan(): import('./types.js').ScannedModule[] { return []; }
  getSourceName(): string { return '__free_fn_scanner__'; }
})();
