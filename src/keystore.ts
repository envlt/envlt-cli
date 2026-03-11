import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { KEY_ID_PATTERN, LOCAL_KEYS_DIR } from './constants.js';
import { AppError, ErrorCode } from './errors.js';
import { err, ok, type Result } from './result.js';
import { createFilesystemAdapter, type StorageAdapter } from './storage/index.js';

const KEY_FILE_MODE = 0o600;
const FILE_MODE_MASK = 0o777;

function getErrorCode(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined;
}

function isValidKeyId(keyId: string): boolean {
  return KEY_ID_PATTERN.test(keyId);
}

function getLocalKeyPath(keyId: string, projectRoot: string): string {
  return path.resolve(projectRoot, LOCAL_KEYS_DIR, keyId);
}

function createInvalidKeyIdError(): AppError {
  return new AppError(ErrorCode.KEYSTORE_INVALID_KEY_ID, 'Invalid key id.');
}

function getAdapter(adapter?: StorageAdapter, projectRoot?: string): StorageAdapter {
  return adapter ?? createFilesystemAdapter(projectRoot ?? process.cwd());
}

async function ensureLocalKeysDirectory(projectRoot: string): Promise<Result<void>> {
  const keysDirectory = path.resolve(projectRoot, LOCAL_KEYS_DIR);

  try {
    await fs.mkdir(keysDirectory, { recursive: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.KEYSTORE_WRITE_ERROR, 'Failed to prepare keys directory.', error),
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
    const errorCode = getErrorCode(error);
    if (errorCode === 'ENOENT') {
      return err(new AppError(ErrorCode.KEYSTORE_KEY_NOT_FOUND, 'Key was not found.', error));
    }

    if (errorCode === 'EACCES' || errorCode === 'EPERM') {
      return err(
        new AppError(
          ErrorCode.KEYSTORE_PERMISSION_ERROR,
          'Failed to read key metadata due to insufficient permissions.',
          error,
        ),
      );
    }
    return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read key metadata.', error));
  }
}

export async function loadKey(
  keyId: string,
  projectRoot: string,
  adapter?: StorageAdapter,
): Promise<Result<string>> {
  if (!isValidKeyId(keyId)) {
    return err(createInvalidKeyIdError());
  }

  const keyPath = getLocalKeyPath(keyId, projectRoot);
  const permissionResult = await checkKeyFilePermissions(keyPath);
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const result = await getAdapter(adapter, projectRoot).read(keyPath);
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
  projectRoot: string,
  adapter?: StorageAdapter,
): Promise<Result<void>> {
  if (!isValidKeyId(keyId)) {
    return err(createInvalidKeyIdError());
  }

  const dirResult = await ensureLocalKeysDirectory(projectRoot);
  if (!dirResult.ok) {
    return dirResult;
  }

  const keyPath = getLocalKeyPath(keyId, projectRoot);
  const result = await getAdapter(adapter, projectRoot).write(keyPath, Buffer.from(key, 'utf8'));
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

export async function listKeys(projectRoot: string): Promise<Result<readonly string[]>> {
  const keysDirectory = path.resolve(projectRoot, LOCAL_KEYS_DIR);

  try {
    const entries = await fs.readdir(keysDirectory, { withFileTypes: true });
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
