import { YAMLWriter } from './yaml-writer.js';
import { TypeScriptWriter } from './typescript-writer.js';
import { RegistryWriter } from './registry-writer.js';
import { InvalidFormatError } from './errors.js';

/**
 * Return the writer for the given output format.
 *
 * @param format - One of `"yaml"`, `"typescript"`, or `"registry"`.
 * @returns The corresponding writer instance.
 * @throws {InvalidFormatError} When `format` is not a recognised format name.
 */
export function getWriter(
  format: string,
): YAMLWriter | TypeScriptWriter | RegistryWriter {
  if (format === 'yaml') return new YAMLWriter();
  if (format === 'typescript') return new TypeScriptWriter();
  if (format === 'registry') return new RegistryWriter();
  throw new InvalidFormatError(format);
}
