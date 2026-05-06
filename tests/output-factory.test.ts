import { describe, it, expect } from 'vitest';
import { getWriter } from '../src/output/factory.js';
import { YAMLWriter } from '../src/output/yaml-writer.js';
import { TypeScriptWriter } from '../src/output/typescript-writer.js';
import { RegistryWriter } from '../src/output/registry-writer.js';
import { HTTPProxyRegistryWriter } from '../src/output/http-proxy-writer.js';

describe('getWriter', () => {
  it('returns YAMLWriter for "yaml"', () => {
    expect(getWriter('yaml')).toBeInstanceOf(YAMLWriter);
  });

  it('returns TypeScriptWriter for "typescript"', () => {
    expect(getWriter('typescript')).toBeInstanceOf(TypeScriptWriter);
  });

  it('returns RegistryWriter for "registry"', () => {
    expect(getWriter('registry')).toBeInstanceOf(RegistryWriter);
  });

  it('throws for unknown format', () => {
    expect(() => getWriter('unknown')).toThrow('Unknown output format: "unknown"');
  });

  it('throws for empty string', () => {
    expect(() => getWriter('')).toThrow('Unknown output format');
  });

  // Issue #5 [D10-003]: "httpproxy" alias (no separator) must be accepted
  it('returns HTTPProxyRegistryWriter for "httpproxy" alias', () => {
    expect(getWriter('httpproxy', { baseUrl: 'http://localhost:8080' })).toBeInstanceOf(HTTPProxyRegistryWriter);
  });

  it('returns HTTPProxyRegistryWriter for "http-proxy"', () => {
    expect(getWriter('http-proxy', { baseUrl: 'http://localhost:8080' })).toBeInstanceOf(HTTPProxyRegistryWriter);
  });

  it('returns HTTPProxyRegistryWriter for "http_proxy"', () => {
    expect(getWriter('http_proxy', { baseUrl: 'http://localhost:8080' })).toBeInstanceOf(HTTPProxyRegistryWriter);
  });

  // Issue #21 [D5-001]: TypeError throw paths for http-proxy
  it('throws TypeError for getWriter("http-proxy") with no options', () => {
    expect(() => getWriter('http-proxy')).toThrow(TypeError);
  });

  it('throws TypeError for getWriter("http-proxy", {}) with no baseUrl', () => {
    expect(() => getWriter('http-proxy', {} as never)).toThrow(TypeError);
  });

  it('throws TypeError for getWriter("http-proxy", { baseUrl: 123 }) where baseUrl is not a string', () => {
    expect(() => getWriter('http-proxy', { baseUrl: 123 as unknown as string })).toThrow(TypeError);
  });
});
