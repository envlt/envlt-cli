import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AppError, ErrorCode } from './errors.js';
import { loadKey, listKeys, saveKey } from './keystore.js';
import type { Result } from './result.js';
import { err, ok } from './result.js';
import { createFilesystemAdapter, type StorageAdapter } from './storage/index.js';

const FILE_MODE_MASK = 0o777;
const KEY_FILE_MODE = 0o600;

let tempHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(tempHome, { recursive: true });
  originalHome = process.env['HOME'];
  process.env['HOME'] = tempHome;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

function keyPathFor(keyId: string): string {
  return path.join(tempHome, '.envlt', 'keys', keyId);
}

function expectOk<T>(result: Result<T>): T {
  assert.equal(result.ok, true);
  return result.value;
}

function expectErr<T>(result: Result<T>): ErrorCode {
  assert.equal(result.ok, false);
  return result.error.code;
}

function createWriteOnlySuccessAdapter(): StorageAdapter {
  return {
    read(): Promise<Result<Buffer>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'read not supported')));
    },
    write(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },
    exists(): Promise<boolean> {
      return Promise.resolve(false);
    },
    delete(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },
  };
}

function createFailingAdapter(): StorageAdapter {
  return {
    read(): Promise<Result<Buffer>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'read failure')));
    },
    write(): Promise<Result<void>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'write failure')));
    },
    exists(): Promise<boolean> {
      return Promise.resolve(false);
    },
    delete(): Promise<Result<void>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'delete failure')));
    },
  };
}

void describe('keystore', () => {
  void it('does write key to expected path when saveKey is called', async () => {
    const keyId = 'service-main';
    const key = 'abc123';
    const adapter = createFilesystemAdapter();

    expectOk(await saveKey(keyId, key, adapter));

    const storedKey = await fs.readFile(keyPathFor(keyId), 'utf8');
    assert.equal(storedKey, key);
  });

  void it('does set file permissions to 0o600 when saveKey succeeds', async () => {
    const keyId = 'perm-check';
    const adapter = createFilesystemAdapter();

    expectOk(await saveKey(keyId, 'secret', adapter));

    const stats = await fs.stat(keyPathFor(keyId));
    assert.equal(stats.mode & FILE_MODE_MASK, KEY_FILE_MODE);
  });

  void it('does load saved key value after saveKey', async () => {
    const keyId = 'roundtrip';
    const key = 'my-master-key';
    const adapter = createFilesystemAdapter();

    expectOk(await saveKey(keyId, key, adapter));
    const loadedKey = expectOk(await loadKey(keyId, adapter));

    assert.equal(loadedKey, key);
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when key file is missing', async () => {
    const adapter = createFilesystemAdapter();
    const code = expectErr(await loadKey('missing-key', adapter));
    assert.equal(code, ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when key file mode is not 0o600', async () => {
    const keyId = 'wrong-perms';
    const adapter = createFilesystemAdapter();

    expectOk(await saveKey(keyId, 'secret', adapter));
    await fs.chmod(keyPathFor(keyId), 0o644);

    const code = expectErr(await loadKey(keyId, adapter));
    assert.equal(code, ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does return KEYSTORE_INVALID_KEY_ID for invalid key IDs in saveKey', async () => {
    const adapter = createFilesystemAdapter();
    const invalidIds = ['', 'bad/id', 'a'.repeat(65)];

    for (const keyId of invalidIds) {
      const code = expectErr(await saveKey(keyId, 'secret', adapter));
      assert.equal(code, ErrorCode.KEYSTORE_INVALID_KEY_ID);
    }
  });

  void it('does return KEYSTORE_INVALID_KEY_ID for invalid key IDs in loadKey', async () => {
    const adapter = createFilesystemAdapter();
    const code = expectErr(await loadKey('bad/id', adapter));
    assert.equal(code, ErrorCode.KEYSTORE_INVALID_KEY_ID);
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when adapter read fails after stat passes', async () => {
    const keyId = 'adapter-fails';
    const keyFile = keyPathFor(keyId);
    await fs.mkdir(path.dirname(keyFile), { recursive: true });
    await fs.writeFile(keyFile, 'secret', 'utf8');
    await fs.chmod(keyFile, KEY_FILE_MODE);

    const code = expectErr(await loadKey(keyId, createFailingAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });

  void it('does return KEYSTORE_WRITE_ERROR when key directory cannot be created', async () => {
    const blockedPath = path.join(tempHome, '.envlt', 'keys');
    await fs.mkdir(path.dirname(blockedPath), { recursive: true });
    await fs.writeFile(blockedPath, 'blocked', 'utf8');

    const code = expectErr(await saveKey('blocked-dir', 'secret', createFilesystemAdapter()));

    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when final chmod fails after write', async () => {
    const code = expectErr(
      await saveKey('chmod-late-fail', 'secret', createWriteOnlySuccessAdapter()),
    );

    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when adapter write fails', async () => {
    const code = expectErr(await saveKey('write-fails', 'secret', createFailingAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when key path chmod fails', async () => {
    const keyId = 'chmod-fails';
    const keyPath = keyPathFor(keyId);
    await fs.mkdir(keyPath, { recursive: true });

    const code = expectErr(await saveKey(keyId, 'secret', createFilesystemAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return empty list when keys directory does not exist', async () => {
    const keyIds = expectOk(await listKeys());
    assert.deepEqual(keyIds, []);
  });

  void it('does list all saved key IDs', async () => {
    const adapter = createFilesystemAdapter();
    const keyIds = ['alpha', 'beta_1', 'gamma-2'];

    for (const keyId of keyIds) {
      expectOk(await saveKey(keyId, `key-${keyId}`, adapter));
    }

    const listedKeyIds = expectOk(await listKeys());
    assert.deepEqual([...listedKeyIds].sort(), [...keyIds].sort());
  });

  void it('does return STORAGE_READ_ERROR when listKeys cannot read directory', async () => {
    const keysDirectory = path.join(tempHome, '.envlt', 'keys');
    await fs.mkdir(path.join(tempHome, '.envlt'), { recursive: true });
    await fs.writeFile(keysDirectory, 'not-a-directory', 'utf8');

    const code = expectErr(await listKeys());
    assert.equal(code, ErrorCode.STORAGE_READ_ERROR);
  });
});
