// JavaScript-specific prototype-pollution guard.
//
// This file has no Python or Rust counterpart: the named keys
// (`__proto__`, `constructor`, `prototype`) are dangerous only under
// JavaScript's prototype-chain semantics. Python and Rust use attribute
// lookups / field accesses that are not affected by this vulnerability
// class, so their SDKs do not need an equivalent.
//
// Typed as `Set<string>` (not the literal union inferred by `as const`) so
// callers can pass arbitrary user-supplied keys to `.has()` without a cast.
// The runtime check is what matters; the compile-time narrowing from `as const`
// would force every caller to pre-narrow their key type, which is impractical
// for keys coming out of `Object.entries`, YAML parses, or OpenAPI schemas.
export const PROTO_DENY: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
