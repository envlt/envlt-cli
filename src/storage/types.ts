import type { Result } from '../result.js';

export type StorageAdapter = {
  readonly read: (path: string) => Promise<Result<Buffer>>;
  readonly write: (path: string, data: Buffer) => Promise<Result<void>>;
  readonly exists: (path: string) => Promise<Result<boolean>>;
  readonly delete: (path: string) => Promise<Result<void>>;
};
