export const enum ErrorCode {
  CRYPTO_DECRYPT_FAILED = 'CRYPTO_DECRYPT_FAILED',
  CRYPTO_INVALID_KEY = 'CRYPTO_INVALID_KEY',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public override readonly cause?: unknown;

  public constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}
