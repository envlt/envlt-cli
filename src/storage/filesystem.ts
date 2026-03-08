import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

import type { StorageAdapter } from './types.js';

const FILE_MODE = 0o600;

function getErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !('code' in cause)) {
    return undefined;
  }

  const { code } = cause;
  return typeof code === 'string' ? code : undefined;
}

function isPathInsideBase(baseDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(baseDirectory, targetPath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function resolveWithinBase(baseDirectory: string, inputPath: string): Result<string> {
  const absolutePath = path.resolve(baseDirectory, inputPath);
  if (!isPathInsideBase(baseDirectory, absolutePath)) {
    return err(
      new AppError(
        ErrorCode.STORAGE_WRITE_ERROR,
        'Path escapes configured storage base directory.',
      ),
    );
  }

  return ok(absolutePath);
}

function toStorageReadError(cause: unknown): AppError {
  return new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read from storage.', cause);
}

function toStorageWriteError(cause: unknown): AppError {
  return new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write to storage.', cause);
}

function toStorageDeleteError(cause: unknown): AppError {
  return new AppError(ErrorCode.STORAGE_DELETE_ERROR, 'Failed to delete from storage.', cause);
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
    await fs.writeFile(absolutePath, data, { mode: FILE_MODE });
    await fs.chmod(absolutePath, FILE_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    return err(toStorageWriteError(error));
  }
}

async function existsFile(absolutePath: string): Promise<Result<boolean>> {
  try {
    await fs.access(absolutePath);
    return ok(true);
  } catch (error: unknown) {
    if (getErrorCode(error) === 'ENOENT') {
      return ok(false);
    }

    return err(toStorageReadError(error));
  }
}

async function deleteFile(absolutePath: string): Promise<Result<void>> {
  try {
    await fs.rm(absolutePath, { force: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err(toStorageDeleteError(error));
  }
}

export function createFilesystemAdapter(baseDirectory: string = process.cwd()): StorageAdapter {
  const resolvedBaseDirectory = path.resolve(baseDirectory);

  async function withResolvedPath<T>(
    inputPath: string,
    operation: (resolvedPath: string) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const resolvedPath = resolveWithinBase(resolvedBaseDirectory, inputPath);
    if (!resolvedPath.ok) {
      return err(resolvedPath.error);
    }

    return operation(resolvedPath.value);
  }

  return {
    read: async (inputPath: string): Promise<Result<Buffer>> =>
      withResolvedPath(inputPath, readFile),
    write: async (inputPath: string, data: Buffer): Promise<Result<void>> =>
      withResolvedPath(inputPath, async (resolvedPath: string) => writeFile(resolvedPath, data)),
    exists: async (inputPath: string): Promise<Result<boolean>> =>
      withResolvedPath(inputPath, existsFile),
    delete: async (inputPath: string): Promise<Result<void>> =>
      withResolvedPath(inputPath, deleteFile),
  };
}
