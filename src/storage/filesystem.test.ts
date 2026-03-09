import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { ErrorCode } from '../errors.js';
import type { Result } from '../result.js';

import { createFilesystemAdapter } from './filesystem.js';

const FILE_MODE_MASK = 0o777;
const EXPECTED_FILE_MODE = 0o600;

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory !== undefined) {
    await fs.rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

function createTempDirectory(): string {
  const directory = path.join(os.tmpdir(), randomUUID());
  tempDirectory = directory;
  return directory;
}

function expectOk<T>(result: Result<T>): T {
  assert.equal(result.ok, true);
  return result.value;
}

function expectErr<T>(result: Result<T>): ErrorCode {
  assert.equal(result.ok, false);
  return result.error.code;
}

void describe('storage/filesystem', () => {
  void it('does round-trip bytes when write then read', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);
    const target = 'roundtrip.bin';
    const data = Buffer.from([0, 1, 2, 3, 255]);

    expectOk(await adapter.write(target, data));
    const value = expectOk(await adapter.read(target));

    assert.deepEqual(value, data);
  });

  void it('does create missing parent directories when write is called', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);
    const target = path.join('a', 'b', 'c', 'value.txt');

    expectOk(await adapter.write(target, Buffer.from('value', 'utf8')));

    const existsResult = await fs.access(path.join(root, 'a', 'b', 'c')).then(
      () => true,
      () => false,
    );

    assert.equal(existsResult, true);
  });

  void it('does set file permissions to 0o600 when writing', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);
    const target = 'permissions.txt';

    expectOk(await adapter.write(target, Buffer.from('secret', 'utf8')));

    const stats = await fs.stat(path.join(root, target));
    assert.equal(stats.mode & FILE_MODE_MASK, EXPECTED_FILE_MODE);
  });

  void it('does return STORAGE_READ_ERROR when reading a missing file', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);

    const code = expectErr(await adapter.read('missing.txt'));

    assert.equal(code, ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return STORAGE_WRITE_ERROR when writing to a directory path', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);
    await fs.mkdir(path.join(root, 'already-a-directory'), { recursive: true });

    const code = expectErr(
      await adapter.write('already-a-directory', Buffer.from('value', 'utf8')),
    );

    assert.equal(code, ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return true for existing file and false for missing file', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);

    expectOk(await adapter.write('exists.txt', Buffer.from('value', 'utf8')));

    const existingResult = expectOk(await adapter.exists('exists.txt'));
    const missingResult = expectOk(await adapter.exists('missing.txt'));

    assert.equal(existingResult, true);
    assert.equal(missingResult, false);
  });

  void it('does delete existing file and no-op for missing file', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);

    expectOk(await adapter.write('delete-me.txt', Buffer.from('value', 'utf8')));

    expectOk(await adapter.delete('delete-me.txt'));
    const existsAfterDelete = expectOk(await adapter.exists('delete-me.txt'));
    assert.equal(existsAfterDelete, false);

    expectOk(await adapter.delete('already-gone.txt'));
  });

  void it('does return STORAGE_DELETE_ERROR when delete fails for non-empty directory', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);
    const directoryPath = path.join(root, 'non-empty-dir');
    await fs.mkdir(directoryPath, { recursive: true });
    await fs.writeFile(path.join(directoryPath, 'child.txt'), 'value', 'utf8');

    const code = expectErr(await adapter.delete('non-empty-dir'));

    assert.equal(code, ErrorCode.STORAGE_DELETE_ERROR);
  });

  void it('does allow dot-prefixed names that begin with two dots inside base directory', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);

    expectOk(await adapter.write('..env', Buffer.from('value', 'utf8')));
    const readValue = expectOk(await adapter.read('..env'));

    assert.equal(readValue.toString('utf8'), 'value');
  });

  void it('does reject traversal attempts with operation-specific error codes', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);

    const writeCode = expectErr(
      await adapter.write(path.join('..', 'escape.txt'), Buffer.from('x', 'utf8')),
    );
    const readCode = expectErr(await adapter.read(path.join('..', 'escape.txt')));
    const deleteCode = expectErr(await adapter.delete(path.join('..', 'escape.txt')));

    assert.equal(writeCode, ErrorCode.STORAGE_WRITE_ERROR);
    assert.equal(readCode, ErrorCode.STORAGE_READ_ERROR);
    assert.equal(deleteCode, ErrorCode.STORAGE_DELETE_ERROR);
  });

  void it('does return STORAGE_READ_ERROR when existence check receives invalid path', async () => {
    const root = createTempDirectory();
    const adapter = createFilesystemAdapter(root);

    const existsResult = await adapter.exists('bad\0path');

    if (existsResult.ok) {
      assert.fail('Expected exists() to fail for invalid path.');
    }

    assert.equal(existsResult.error.code, ErrorCode.STORAGE_READ_ERROR);
  });
});
