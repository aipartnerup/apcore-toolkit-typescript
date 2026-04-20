import { describe, it, expect } from 'vitest';
import { WriteError, InvalidFormatError } from '../src/output/errors.js';

describe('WriteError', () => {
  it('sets name to "WriteError"', () => {
    const err = new WriteError('/path/to/file', new Error('disk full'));
    expect(err.name).toBe('WriteError');
  });

  it('sets path property', () => {
    const err = new WriteError('/tmp/out/mod.ts', new Error('permission denied'));
    expect(err.path).toBe('/tmp/out/mod.ts');
  });

  it('message includes path and cause message', () => {
    const err = new WriteError('/tmp/x', new Error('disk full'));
    expect(err.message).toContain('/tmp/x');
    expect(err.message).toContain('disk full');
  });

  it('is instanceof Error', () => {
    const err = new WriteError('/path', new Error('oops'));
    expect(err).toBeInstanceOf(Error);
  });

  it('cause is set via super() — no double-assignment side effects', () => {
    const cause = new Error('root cause');
    const err = new WriteError('/path', cause);
    expect(err.cause).toBe(cause);
  });

  // W25 regression: non-Error cause must not yield undefined .message
  it('accepts non-Error cause (unknown) and produces valid message', () => {
    const err = new WriteError('/path', 'string cause');
    expect(err.message).toContain('string cause');
    expect(err.cause).toBe('string cause');
  });

  it('accepts numeric cause', () => {
    const err = new WriteError('/path', 42);
    expect(err.message).toContain('42');
  });
});

describe('InvalidFormatError', () => {
  it('sets name to "InvalidFormatError"', () => {
    const err = new InvalidFormatError('xml');
    expect(err.name).toBe('InvalidFormatError');
  });

  it('includes the format name in the message', () => {
    const err = new InvalidFormatError('protobuf');
    expect(err.message).toContain('protobuf');
  });

  it('accepts an optional cause option', () => {
    const cause = new Error('root');
    const err = new InvalidFormatError('json', { cause });
    expect(err.cause).toBe(cause);
  });

  it('is instanceof Error', () => {
    expect(new InvalidFormatError('csv')).toBeInstanceOf(Error);
  });
});
