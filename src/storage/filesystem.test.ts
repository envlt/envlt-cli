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
const originalCwd = process.cwd();

let tempDirectory: string | undefined;

afterEach(async () => {
  process.chdir(originalCwd);
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
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const target = path.join(root, 'roundtrip.bin');
    const data = Buffer.from([0, 1, 2, 3, 255]);

    expectOk(await adapter.write(target, data));
    const value = expectOk(await adapter.read(target));

    assert.deepEqual(value, data);
  });

  void it('does create missing parent directories when write is called', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const target = path.join(root, 'a', 'b', 'c', 'value.txt');

    expectOk(await adapter.write(target, Buffer.from('value', 'utf8')));

    const existsResult = await fs.access(path.dirname(target)).then(
      () => true,
      () => false,
    );

    assert.equal(existsResult, true);
  });

  void it('does set file permissions to 0o600 when writing', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const target = path.join(root, 'permissions.txt');

    expectOk(await adapter.write(target, Buffer.from('secret', 'utf8')));

    const stats = await fs.stat(target);
    assert.equal(stats.mode & FILE_MODE_MASK, EXPECTED_FILE_MODE);
  });

  void it('does return STORAGE_READ_ERROR when reading a missing file', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const target = path.join(root, 'missing.txt');

    const code = expectErr(await adapter.read(target));

    assert.equal(code, ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return STORAGE_WRITE_ERROR when writing to a directory path', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const directoryPath = path.join(root, 'already-a-directory');
    await fs.mkdir(directoryPath, { recursive: true });

    const code = expectErr(await adapter.write(directoryPath, Buffer.from('value', 'utf8')));

    assert.equal(code, ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return true for existing file and false for missing file', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const existingFile = path.join(root, 'exists.txt');
    const missingFile = path.join(root, 'missing.txt');

    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(existingFile, 'value', 'utf8');

    assert.equal(await adapter.exists(existingFile), true);
    assert.equal(await adapter.exists(missingFile), false);
  });

  void it('does delete existing file and no-op for missing file', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const existingFile = path.join(root, 'delete-me.txt');
    const missingFile = path.join(root, 'already-gone.txt');

    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(existingFile, 'value', 'utf8');

    expectOk(await adapter.delete(existingFile));
    assert.equal(await adapter.exists(existingFile), false);

    expectOk(await adapter.delete(missingFile));
  });

  void it('does return STORAGE_WRITE_ERROR when delete fails for non-empty directory', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const directoryPath = path.join(root, 'non-empty-dir');
    await fs.mkdir(directoryPath, { recursive: true });
    await fs.writeFile(path.join(directoryPath, 'child.txt'), 'value', 'utf8');

    const code = expectErr(await adapter.delete(directoryPath));

    assert.equal(code, ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does resolve traversal-like relative paths safely with path.resolve', async () => {
    const adapter = createFilesystemAdapter();
    const root = createTempDirectory();
    const nestedDirectory = path.join(root, 'nested', 'deeper');

    await fs.mkdir(nestedDirectory, { recursive: true });
    process.chdir(nestedDirectory);

    const traversalPath = '../../etc/passwd';
    const expectedResolvedPath = path.resolve(traversalPath);

    expectOk(await adapter.write(traversalPath, Buffer.from('safe', 'utf8')));

    assert.equal(expectedResolvedPath.startsWith(root), true);
    const contents = await fs.readFile(expectedResolvedPath, 'utf8');
    assert.equal(contents, 'safe');
  });
});
