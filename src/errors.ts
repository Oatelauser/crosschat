/** Machine-readable error shared by all multichat modules. */
export class MultichatError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = 'MultichatError';
    this.code = code;
  }
}
