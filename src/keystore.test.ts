import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AppError, ErrorCode } from './errors.js';
import { loadKey, listKeys, saveKey } from './keystore.js';
import { err, ok, type Result } from './result.js';
import { createFilesystemAdapter, type StorageAdapter } from './storage/index.js';

const FILE_MODE_MASK = 0o777;
const KEY_FILE_MODE = 0o600;
const KEY_DIRECTORY_MODE = 0o700;

let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(tempHome, { recursive: true });

  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }

  if (originalUserProfile === undefined) {
    delete process.env['USERPROFILE'];
  } else {
    process.env['USERPROFILE'] = originalUserProfile;
  }

  await fs.rm(tempHome, { recursive: true, force: true });
});

function keysDirectory(): string {
  return path.join(tempHome, '.envlt', 'keys');
}

function keyPathFor(keyId: string): string {
  return path.join(keysDirectory(), keyId);
}

function createTempAdapter(): StorageAdapter {
  return createFilesystemAdapter(tempHome);
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

function createWriteOnlySuccessAdapter(): StorageAdapter {
  return {
    read(): Promise<Result<Buffer>> {
      return Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'read failure')));
    },
    write(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },
    exists(): Promise<Result<boolean>> {
      return Promise.resolve(ok(false));
    },
    delete(): Promise<Result<void>> {
      return Promise.resolve(ok(undefined));
    },
  };
}

void describe('keystore', () => {
  void it('does write key to expected path when saveKey is called', async () => {
    expectOk(await saveKey('service-main', 'abc123', createTempAdapter()));

    const storedKey = await fs.readFile(keyPathFor('service-main'), 'utf8');
    assert.equal(storedKey, 'abc123');
  });

  void it('does create key directory with 0o700 permissions', async () => {
    expectOk(await saveKey('dir-mode', 'abc123', createTempAdapter()));

    const stats = await fs.stat(keysDirectory());
    assert.equal(stats.mode & FILE_MODE_MASK, KEY_DIRECTORY_MODE);
  });

  void it('does set file permissions to 0o600 when saveKey succeeds', async () => {
    expectOk(await saveKey('perm-check', 'secret', createTempAdapter()));

    const stats = await fs.stat(keyPathFor('perm-check'));
    assert.equal(stats.mode & FILE_MODE_MASK, KEY_FILE_MODE);
  });

  void it('does load saved key value after saveKey', async () => {
    expectOk(await saveKey('roundtrip', 'my-master-key', createTempAdapter()));
    const loadedKey = expectOk(await loadKey('roundtrip', createTempAdapter()));

    assert.equal(loadedKey, 'my-master-key');
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when key file is missing', async () => {
    const code = expectErr(await loadKey('missing-key', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when key directory stat fails with non-ENOENT', async () => {
    await fs.writeFile(path.join(tempHome, '.envlt'), 'not-a-directory', 'utf8');

    const code = expectErr(await loadKey('missing-key', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when key file is missing in existing directory', async () => {
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.chmod(keysDirectory(), KEY_DIRECTORY_MODE);

    const code = expectErr(await loadKey('missing-key', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when key directory mode is not 0o700', async () => {
    expectOk(await saveKey('key-a', 'secret', createTempAdapter()));
    await fs.chmod(keysDirectory(), 0o755);

    const code = expectErr(await loadKey('key-a', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when key file mode is not 0o600', async () => {
    expectOk(await saveKey('wrong-perms', 'secret', createTempAdapter()));
    await fs.chmod(keyPathFor('wrong-perms'), 0o644);

    const code = expectErr(await loadKey('wrong-perms', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does return KEYSTORE_INVALID_KEY_ID for invalid key IDs in saveKey', async () => {
    for (const keyId of ['', 'bad/id', 'a'.repeat(65)]) {
      const code = expectErr(await saveKey(keyId, 'secret', createTempAdapter()));
      assert.equal(code, ErrorCode.KEYSTORE_INVALID_KEY_ID);
    }
  });

  void it('does return KEYSTORE_INVALID_KEY_ID for invalid key IDs in loadKey', async () => {
    const code = expectErr(await loadKey('bad/id', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_INVALID_KEY_ID);
  });

  void it('does return STORAGE_READ_ERROR when key metadata cannot be read', async () => {
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.chmod(keysDirectory(), KEY_DIRECTORY_MODE);
    await fs.symlink('loop-key', keyPathFor('loop-key'));

    const code = expectErr(await loadKey('loop-key', createTempAdapter()));
    assert.equal(code, ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return STORAGE_READ_ERROR when adapter read fails after stat passes', async () => {
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.writeFile(keyPathFor('adapter-fails'), 'secret', 'utf8');
    await fs.chmod(keysDirectory(), KEY_DIRECTORY_MODE);
    await fs.chmod(keyPathFor('adapter-fails'), KEY_FILE_MODE);

    const code = expectErr(await loadKey('adapter-fails', createFailingAdapter()));
    assert.equal(code, ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when key directory cannot be created', async () => {
    await fs.mkdir(path.join(tempHome, '.envlt'), { recursive: true });
    await fs.writeFile(keysDirectory(), 'blocked', 'utf8');

    const code = expectErr(await saveKey('blocked-dir', 'secret', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when chmod fails after write', async () => {
    const keyPath = keyPathFor('chmod-fails');
    await fs.mkdir(keyPath, { recursive: true });

    const code = expectErr(await saveKey('chmod-fails', 'secret', createTempAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when chmod fails after successful adapter write', async () => {
    const code = expectErr(
      await saveKey('chmod-late-fail', 'secret', createWriteOnlySuccessAdapter()),
    );
    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return KEYSTORE_WRITE_ERROR when adapter write fails', async () => {
    const code = expectErr(await saveKey('write-fails', 'secret', createFailingAdapter()));
    assert.equal(code, ErrorCode.KEYSTORE_WRITE_ERROR);
  });

  void it('does return empty list when keys directory does not exist', async () => {
    const keyIds = expectOk(await listKeys());
    assert.deepEqual(keyIds, []);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when listing keys with wrong directory mode', async () => {
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.chmod(keysDirectory(), 0o755);

    const code = expectErr(await listKeys());
    assert.equal(code, ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does return STORAGE_READ_ERROR when listKeys reads a non-directory keys path', async () => {
    await fs.mkdir(path.join(tempHome, '.envlt'), { recursive: true });
    await fs.writeFile(keysDirectory(), 'not-a-directory', { mode: KEY_DIRECTORY_MODE });
    await fs.chmod(keysDirectory(), KEY_DIRECTORY_MODE);

    const code = expectErr(await listKeys());
    assert.equal(code, ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return KEYSTORE_PERMISSION_ERROR when keys directory path is not a secured directory', async () => {
    await fs.mkdir(path.join(tempHome, '.envlt'), { recursive: true });
    await fs.writeFile(keysDirectory(), 'not-a-directory', 'utf8');

    const code = expectErr(await listKeys());
    assert.equal(code, ErrorCode.KEYSTORE_PERMISSION_ERROR);
  });

  void it('does exclude non-key filenames from listKeys results', async () => {
    await fs.mkdir(keysDirectory(), { recursive: true });
    await fs.chmod(keysDirectory(), KEY_DIRECTORY_MODE);

    await fs.writeFile(keyPathFor('valid_key'), 'ok', 'utf8');
    await fs.chmod(keyPathFor('valid_key'), KEY_FILE_MODE);
    await fs.writeFile(keyPathFor('bad.key'), 'ignore', 'utf8');
    await fs.chmod(keyPathFor('bad.key'), KEY_FILE_MODE);

    const listedKeyIds = expectOk(await listKeys());
    assert.deepEqual([...listedKeyIds], ['valid_key']);
  });

  void it('does list all saved key IDs', async () => {
    const adapter = createTempAdapter();
    for (const keyId of ['alpha', 'beta_1', 'gamma-2']) {
      expectOk(await saveKey(keyId, `key-${keyId}`, adapter));
    }

    const listedKeyIds = expectOk(await listKeys());
    assert.deepEqual([...listedKeyIds].sort(), ['alpha', 'beta_1', 'gamma-2'].sort());
  });
});
