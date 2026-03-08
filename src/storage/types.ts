import type { Result } from '../result.js';

export interface StorageAdapter {
  read(path: string): Promise<Result<Buffer>>;
  write(path: string, data: Buffer): Promise<Result<void>>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<Result<void>>;
}
