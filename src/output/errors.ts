export class InvalidFormatError extends Error {
  constructor(format: string, options?: { cause?: unknown }) {
    super(`Unknown output format: "${format}"`, options);
    this.name = 'InvalidFormatError';
  }
}

export class WriteError extends Error {
  readonly path: string;
  declare readonly cause: unknown;

  constructor(path: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Write failed for ${path}: ${message}`, { cause });
    this.name = 'WriteError';
    this.path = path;
  }
}
