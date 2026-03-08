import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { AppError, ErrorCode } from './errors.js';
import { err, ok, type Result } from './result.js';
import { createFilesystemAdapter, type StorageAdapter } from './storage/index.js';

const KEY_DIRECTORY_MODE = 0o700;
const KEY_FILE_MODE = 0o600;
const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function resolveKeysDirectory(): string {
  return path.resolve(os.homedir(), '.envlt', 'keys');
}

function isValidKeyId(keyId: string): boolean {
  return KEY_ID_PATTERN.test(keyId);
}

function getKeyPath(keyId: string): string {
  return path.resolve(resolveKeysDirectory(), keyId);
}

function createInvalidKeyIdError(): AppError {
  return new AppError(ErrorCode.KEYSTORE_INVALID_KEY_ID, 'Invalid key id.');
}

function getAdapter(adapter?: StorageAdapter): StorageAdapter {
  return adapter ?? createFilesystemAdapter();
}

async function ensureDirectoryPermissions(): Promise<Result<void>> {
  const keysDirectory = resolveKeysDirectory();

  try {
    await fs.mkdir(keysDirectory, { recursive: true, mode: KEY_DIRECTORY_MODE });
    await fs.chmod(keysDirectory, KEY_DIRECTORY_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.KEYSTORE_WRITE_ERROR, 'Failed to prepare key directory.', error),
    );
  }
}

export async function loadKey(keyId: string, adapter?: StorageAdapter): Promise<Result<string>> {
  if (!isValidKeyId(keyId)) {
    return err(createInvalidKeyIdError());
  }

  const keyPath = getKeyPath(keyId);

  try {
    const stats = await fs.stat(keyPath);
    if ((stats.mode & 0o777) !== KEY_FILE_MODE) {
      return err(
        new AppError(ErrorCode.KEYSTORE_PERMISSION_ERROR, 'Invalid key file permissions.'),
      );
    }
  } catch (error: unknown) {
    return err(new AppError(ErrorCode.KEYSTORE_KEY_NOT_FOUND, 'Key was not found.', error));
  }

  const result = await getAdapter(adapter).read(keyPath);
  if (!result.ok) {
    return err(new AppError(ErrorCode.KEYSTORE_KEY_NOT_FOUND, 'Key was not found.', result.error));
  }

  return ok(result.value.toString('utf8'));
}

export async function saveKey(
  keyId: string,
  key: string,
  adapter?: StorageAdapter,
): Promise<Result<void>> {
  if (!isValidKeyId(keyId)) {
    return err(createInvalidKeyIdError());
  }

  const dirResult = await ensureDirectoryPermissions();
  if (!dirResult.ok) {
    return dirResult;
  }

  const keyPath = getKeyPath(keyId);
  const result = await getAdapter(adapter).write(keyPath, Buffer.from(key, 'utf8'));

  if (!result.ok) {
    return err(new AppError(ErrorCode.KEYSTORE_WRITE_ERROR, 'Failed to write key.', result.error));
  }

  try {
    await fs.chmod(keyPath, KEY_FILE_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.KEYSTORE_WRITE_ERROR, 'Failed to set key permissions.', error),
    );
  }
}

export async function listKeys(): Promise<Result<readonly string[]>> {
  const keysDirectory = resolveKeysDirectory();

  try {
    const entries = await fs.readdir(keysDirectory, { withFileTypes: true });
    const keyIds = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    return ok(keyIds);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'ENOENT'
    ) {
      return ok([]);
    }

    return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to list keys.', error));
  }
}
