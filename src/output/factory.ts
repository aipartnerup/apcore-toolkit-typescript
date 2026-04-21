import { YAMLWriter } from './yaml-writer.js';
import { TypeScriptWriter } from './typescript-writer.js';
import { RegistryWriter } from './registry-writer.js';
import {
  HTTPProxyRegistryWriter,
  type HTTPProxyRegistryWriterOptions,
} from './http-proxy-writer.js';
import { InvalidFormatError } from './errors.js';

/**
 * Return the writer for the given output format.
 *
 * @param format - One of `"yaml"`, `"typescript"`, `"registry"`, or
 *   `"http-proxy"` / `"http_proxy"`.
 * @param options - Required for `"http-proxy"`: must be
 *   {@link HTTPProxyRegistryWriterOptions}. Ignored for the other formats.
 * @returns The corresponding writer instance.
 * @throws {InvalidFormatError} When `format` is not a recognised format name.
 * @throws {TypeError} When `options` is missing for `"http-proxy"`.
 */
export function getWriter(
  format: string,
  options?: HTTPProxyRegistryWriterOptions,
): YAMLWriter | TypeScriptWriter | RegistryWriter | HTTPProxyRegistryWriter {
  if (format === 'yaml') return new YAMLWriter();
  if (format === 'typescript') return new TypeScriptWriter();
  if (format === 'registry') return new RegistryWriter();
  if (format === 'http-proxy' || format === 'http_proxy') {
    if (!options || typeof options.baseUrl !== 'string') {
      throw new TypeError(
        "getWriter('http-proxy', options) requires options.baseUrl",
      );
    }
    return new HTTPProxyRegistryWriter(options);
  }
  throw new InvalidFormatError(format);
}
