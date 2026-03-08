import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { AppError, ErrorCode } from './errors.js';
import { err, ok, type Result } from './result.js';
import { createFilesystemAdapter, type StorageAdapter } from './storage/index.js';

const KEY_DIRECTORY_MODE = 0o700;
const KEY_FILE_MODE = 0o600;
const FILE_MODE_MASK = 0o777;
const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function resolveKeysDirectory(): string {
  return path.resolve(os.homedir(), '.envlt', 'keys');
}

function getErrorCode(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined;
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
  return adapter ?? createFilesystemAdapter(resolveKeysDirectory());
}

async function ensureKeyDirectoryExists(): Promise<Result<void>> {
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

async function checkKeyDirectoryPermissions(missingIsOk: boolean): Promise<Result<void>> {
  try {
    const stats = await fs.stat(resolveKeysDirectory());
    if ((stats.mode & FILE_MODE_MASK) !== KEY_DIRECTORY_MODE) {
      return err(new AppError(ErrorCode.KEYSTORE_PERMISSION_ERROR, 'Invalid key directory mode.'));
    }

    return ok(undefined);
  } catch (error: unknown) {
    if (missingIsOk && getErrorCode(error) === 'ENOENT') {
      return ok(undefined);
    }

    if (getErrorCode(error) === 'ENOENT') {
      return err(
        new AppError(ErrorCode.KEYSTORE_KEY_NOT_FOUND, 'Key directory was not found.', error),
      );
    }

    return err(
      new AppError(ErrorCode.KEYSTORE_PERMISSION_ERROR, 'Failed to verify key directory.', error),
    );
  }
}

async function checkKeyFilePermissions(keyPath: string): Promise<Result<void>> {
  try {
    const stats = await fs.stat(keyPath);
    if ((stats.mode & FILE_MODE_MASK) !== KEY_FILE_MODE) {
      return err(
        new AppError(ErrorCode.KEYSTORE_PERMISSION_ERROR, 'Invalid key file permissions.'),
      );
    }

    return ok(undefined);
  } catch (error: unknown) {
    if (getErrorCode(error) === 'ENOENT') {
      return err(new AppError(ErrorCode.KEYSTORE_KEY_NOT_FOUND, 'Key was not found.', error));
    }

    return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read key metadata.', error));
  }
}

export async function loadKey(keyId: string, adapter?: StorageAdapter): Promise<Result<string>> {
  if (!isValidKeyId(keyId)) {
    return err(createInvalidKeyIdError());
  }

  const directoryResult = await checkKeyDirectoryPermissions(false);
  if (!directoryResult.ok) {
    return directoryResult;
  }

  const keyPath = getKeyPath(keyId);
  const permissionResult = await checkKeyFilePermissions(keyPath);
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const result = await getAdapter(adapter).read(keyPath);
  if (!result.ok) {
    return err(
      new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to load key contents.', result.error),
    );
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

  const dirResult = await ensureKeyDirectoryExists();
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
  const permissionCheckResult = await checkKeyDirectoryPermissions(true);
  if (!permissionCheckResult.ok) {
    return permissionCheckResult;
  }

  try {
    const entries = await fs.readdir(resolveKeysDirectory(), { withFileTypes: true });
    const keyIds = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((entryName) => isValidKeyId(entryName));

    return ok(keyIds);
  } catch (error: unknown) {
    if (getErrorCode(error) === 'ENOENT') {
      return ok([]);
    }

    return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to list keys.', error));
  }
}
