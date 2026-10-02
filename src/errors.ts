/** Machine-readable error shared by all multichat modules. */
export class MultichatError extends Error {
  readonly code: string;
  /** Bounded stderr tail of a spawned child process, when one failed. */
  stderrText?: string;

  constructor(code: string, message: string, options?: { cause?: unknown; stderrText?: string }) {
    super(message, options as ErrorOptions);
    this.name = 'MultichatError';
    this.code = code;
    if (options?.stderrText !== undefined && options.stderrText !== '') {
      this.stderrText = options.stderrText;
    }
  }
}
