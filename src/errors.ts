export const enum ErrorCode {
  CRYPTO_DECRYPT_FAILED = 'CRYPTO_DECRYPT_FAILED',
  CRYPTO_INVALID_KEY = 'CRYPTO_INVALID_KEY',
  STORAGE_READ_ERROR = 'STORAGE_READ_ERROR',
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',
  STORAGE_DELETE_ERROR = 'STORAGE_DELETE_ERROR',
  KEYSTORE_KEY_NOT_FOUND = 'KEYSTORE_KEY_NOT_FOUND',
  KEYSTORE_PERMISSION_ERROR = 'KEYSTORE_PERMISSION_ERROR',
  KEYSTORE_WRITE_ERROR = 'KEYSTORE_WRITE_ERROR',
  KEYSTORE_INVALID_KEY_ID = 'KEYSTORE_INVALID_KEY_ID',
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
