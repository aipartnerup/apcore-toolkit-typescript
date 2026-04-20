import { PROTO_DENY } from './internal/safe-keys.js';

/**
 * Enrich a JSON Schema's property descriptions from an external map.
 *
 * Returns the original schema reference when no enrichment is needed;
 * otherwise returns a deep copy with descriptions merged in.
 */
export function enrichSchemaDescriptions(
  schema: Record<string, unknown>,
  paramDescriptions: Record<string, string>,
  options?: { overwrite?: boolean },
): Record<string, unknown> {
  if (Object.keys(paramDescriptions).length === 0) {
    return schema;
  }

  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) {
    return schema;
  }

  const overwrite = options?.overwrite ?? false;
  let result: Record<string, unknown>;
  try {
    result = structuredClone(schema);
  } catch (err) {
    throw new Error(
      `enrichSchemaDescriptions: schema is not cloneable — ${(err as Error).message}`,
      { cause: err },
    );
  }
  const resultProps = result.properties as Record<string, Record<string, unknown>>;

  for (const [name, desc] of Object.entries(paramDescriptions)) {
    if (PROTO_DENY.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(resultProps, name)) {
      const prop = resultProps[name];
      if (prop === null || typeof prop !== 'object' || Array.isArray(prop)) continue;
      if (overwrite || !("description" in prop)) {
        prop.description = desc;
      }
    }
  }

  return result;
}
