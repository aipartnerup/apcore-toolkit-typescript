export class InvalidFormatError extends Error {
  constructor(format: string, options?: { cause?: unknown }) {
    super(`Unknown output format: "${format}"`, options);
    this.name = 'InvalidFormatError';
  }
}

export class WriteError extends Error {
  readonly path: string;
  declare override readonly cause: Error;

  constructor(path: string, cause: Error) {
    super(`Write failed for ${path}: ${cause.message}`, { cause });
    this.name = 'WriteError';
    this.path = path;
  }
}
