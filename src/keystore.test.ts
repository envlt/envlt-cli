import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AppError, ErrorCode } from './errors.js';
import { loadKey, listKeys, saveKey } from './keystore.js';
import { err, ok, type Result } from './result.js';
import { type StorageAdapter } from './storage/index.js';

const FILE_MODE_MASK = 0o777;
const KEY_FILE_MODE = 0o600;

let tempProjectRoot: string;

beforeEach(async () => {
  tempProjectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(tempProjectRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempProjectRoot, { recursive: true, force: true });
});

function keysDirectory(): string {
  return path.join(tempProjectRoot, '.envlt', 'keys');
}

function keyPathFor(keyId: string): string {
  return path.join(keysDirectory(), keyId);
}

function expectOk<T>(result: Result<T>): T {
  assert.equal(result.ok, true);
  return result.value;
}

function expectErr<T>(result: Result<T>): ErrorCode {
  assert.equal(result.ok, false);
  return result.error.code;
}

function createFailingAdapter(): StorageAdapter {
  return {
    read(): Promise<Result<Buffer>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'read failure')));
    },
    write(): Promise<Result<void>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'write failure')));
    },
    exists(): Promise<Result<boolean>> {
      return Promise.resolve(ok(false));
    },
    delete(): Promise<Result<void>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_DELETE_ERROR, 'delete failure')));
    },
  };
}

void describe('keystore', () => {
  void it('does save key with correct permissions', async () => {
    const keyId = 'test-key-123';
    const key = 'a'.repeat(64);

    const result = await saveKey(keyId, key, tempProjectRoot);

    expectOk(result);
    const savedContent = await fs.readFile(keyPathFor(keyId), 'utf8');
    assert.equal(savedContent, key);

    const stats = await fs.stat(keyPathFor(keyId));
    assert.equal(stats.mode & FILE_MODE_MASK, KEY_FILE_MODE);
  });

  void it('does load key from local directory', async () => {
    const keyId = 'test-key-456';
    const key = 'b'.repeat(64);
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.writeFile(keyPathFor(keyId), key, { mode: KEY_FILE_MODE });

    const result = await loadKey(keyId, tempProjectRoot);

    assert.equal(expectOk(result), key);
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when key does not exist', async () => {
    const result = await loadKey('missing-key', tempProjectRoot);

    assert.equal(expectErr(result), ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when key file has incorrect permissions', async () => {
    const keyId = 'test-key-789';
    const key = 'c'.repeat(64);
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.writeFile(keyPathFor(keyId), key, { mode: 0o644 });

    const result = await loadKey(keyId, tempProjectRoot);

    assert.equal(expectErr(result), ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does return KEYSTORE_INVALID_KEY_ID for invalid key id', async () => {
    const result = await saveKey('invalid key!', 'key', tempProjectRoot);

    assert.equal(expectErr(result), ErrorCode.KEYSTORE_INVALID_KEY_ID);
  });

  void it('does list all keys in local directory', async () => {
    await saveKey('key-1', 'a'.repeat(64), tempProjectRoot);
    await saveKey('key-2', 'b'.repeat(64), tempProjectRoot);

    const result = await listKeys(tempProjectRoot);

    const keys = expectOk(result);
    assert.ok(keys.includes('key-1'));
    assert.ok(keys.includes('key-2'));
  });

  void it('does return empty array when keys directory does not exist', async () => {
    const result = await listKeys(tempProjectRoot);

    assert.deepEqual(expectOk(result), []);
  });

  void it('does return STORAGE_WRITE_ERROR when adapter write fails', async () => {
    const result = await saveKey('key-1', 'key', tempProjectRoot, createFailingAdapter());

    assert.equal(expectErr(result), ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return STORAGE_READ_ERROR when adapter read fails', async () => {
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.writeFile(keyPathFor('key-1'), 'key', { mode: KEY_FILE_MODE });

    const result = await loadKey('key-1', tempProjectRoot, createFailingAdapter());

    assert.equal(expectErr(result), ErrorCode.STORAGE_READ_ERROR);
  });
});
