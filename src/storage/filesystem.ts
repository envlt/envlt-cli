import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

import type { StorageAdapter } from './types.js';

const FILE_MODE = 0o600;

function resolvePath(inputPath: string): string {
  return path.resolve(inputPath);
}

function toStorageReadError(cause: unknown): AppError {
  return new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read from storage.', cause);
}

function toStorageWriteError(cause: unknown): AppError {
  return new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write to storage.', cause);
}

async function readFile(absolutePath: string): Promise<Result<Buffer>> {
  try {
    return ok(await fs.readFile(absolutePath));
  } catch (error: unknown) {
    return err(toStorageReadError(error));
  }
}

async function writeFile(absolutePath: string, data: Buffer): Promise<Result<void>> {
  try {
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(absolutePath, data);
    await fs.chmod(absolutePath, FILE_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    return err(toStorageWriteError(error));
  }
}

async function existsFile(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function deleteFile(absolutePath: string): Promise<Result<void>> {
  try {
    await fs.rm(absolutePath, { force: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to delete from storage.', error),
    );
  }
}

export function createFilesystemAdapter(): StorageAdapter {
  return {
    async read(inputPath: string): Promise<Result<Buffer>> {
      return readFile(resolvePath(inputPath));
    },
    async write(inputPath: string, data: Buffer): Promise<Result<void>> {
      return writeFile(resolvePath(inputPath), data);
    },
    async exists(inputPath: string): Promise<boolean> {
      return existsFile(resolvePath(inputPath));
    },
    async delete(inputPath: string): Promise<Result<void>> {
      return deleteFile(resolvePath(inputPath));
    },
  };
}
