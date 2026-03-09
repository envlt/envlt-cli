import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import sinon from 'sinon';

import { writeConfig, type EnvltConfig } from '../config.js';
import { readEncEnv, writeEncEnv } from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { saveKey } from '../keystore.js';
import { logger } from '../logger.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter, type StorageAdapter } from '../storage/index.js';

import { runEdit } from './edit.js';

const FIXTURE_EDITOR_OK = path.resolve('tests/fixtures/fake-editor-ok.sh');
const FIXTURE_EDITOR_ABORT = path.resolve('tests/fixtures/fake-editor-abort.sh');
const FIXTURE_EDITOR_INVALID = path.resolve('tests/fixtures/fake-editor-invalid.sh');
const MODE_MASK = 0o777;
const SECURE_FILE_MODE = 0o600;

let projectRoot = '';
let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalEditor: string | undefined;
let originalVisual: string | undefined;
let originalPath: string | undefined;

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function expectErrorCode<T>(result: Result<T>): ErrorCode {
  if (result.ok || !(result.error instanceof AppError)) {
    throw new Error('Expected AppError result.');
  }

  return result.error.code;
}

async function setupFixture(): Promise<string> {
  const key = 'f'.repeat(64);
  const config: EnvltConfig = {
    appName: 'envlt',
    envs: ['test'],
    keyId: 'main',
  };

  const adapter = createFilesystemAdapter(projectRoot);
  expectOk(await writeConfig(config, projectRoot, adapter));
  expectOk(await saveKey('main', key));
  return key;
}

beforeEach(async () => {
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  originalEditor = process.env['EDITOR'];
  originalVisual = process.env['VISUAL'];
  originalPath = process.env['PATH'];

  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });

  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
  delete process.env['EDITOR'];
  delete process.env['VISUAL'];
  delete process.env['ENVLT_CAPTURE_TMP_PATH'];
  delete process.env['ENVLT_CAPTURE_TMP_MODE'];
});

afterEach(async () => {
  sinon.restore();

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

  if (originalEditor === undefined) {
    delete process.env['EDITOR'];
  } else {
    process.env['EDITOR'] = originalEditor;
  }

  if (originalVisual === undefined) {
    delete process.env['VISUAL'];
  } else {
    process.env['VISUAL'] = originalVisual;
  }

  if (originalPath === undefined) {
    delete process.env['PATH'];
  } else {
    process.env['PATH'] = originalPath;
  }

  delete process.env['ENVLT_CAPTURE_TMP_PATH'];
  delete process.env['ENVLT_CAPTURE_TMP_MODE'];

  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('commands/edit', () => {
  void it('does return storage error when adapter exists check fails', async () => {
    await setupFixture();
    const deps = {
      createAdapter: (): StorageAdapter => ({
        read: (): Promise<Result<Buffer>> =>
          Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'read failed'))),
        write: (): Promise<Result<void>> => Promise.resolve(ok(undefined)),
        exists: (): Promise<Result<boolean>> =>
          Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'exists failed'))),
        delete: (): Promise<Result<void>> => Promise.resolve(ok(undefined)),
      }),
      writeFile: fs.writeFile,
      chmod: fs.chmod,
      readFile: fs.readFile,
      unlink: fs.unlink,
      runEditor: spawnSync,
    };

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK }, deps);
    assert.equal(expectErrorCode(result), ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return STORAGE_WRITE_ERROR when temporary file creation fails', async () => {
    await setupFixture();
    const deps = {
      createAdapter: createFilesystemAdapter,
      writeFile: (): Promise<void> => Promise.reject(new Error('temp write failed')),
      chmod: fs.chmod,
      readFile: fs.readFile,
      unlink: fs.unlink,
      runEditor: spawnSync,
    };

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK }, deps);
    assert.equal(expectErrorCode(result), ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return STORAGE_WRITE_ERROR when encrypted save fails', async () => {
    await setupFixture();
    const deps = {
      createAdapter: (root: string): StorageAdapter => {
        const adapter = createFilesystemAdapter(root);
        return {
          read: adapter.read,
          exists: adapter.exists,
          delete: adapter.delete,
          write: (): Promise<Result<void>> =>
            Promise.resolve(err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'write failed'))),
        };
      },
      writeFile: fs.writeFile,
      chmod: fs.chmod,
      readFile: fs.readFile,
      unlink: fs.unlink,
      runEditor: spawnSync,
    };

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK }, deps);
    assert.equal(expectErrorCode(result), ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return original AppError when editor runner throws AppError', async () => {
    await setupFixture();
    const deps = {
      createAdapter: createFilesystemAdapter,
      writeFile: fs.writeFile,
      chmod: fs.chmod,
      readFile: fs.readFile,
      unlink: fs.unlink,
      runEditor: (): never => {
        throw new AppError(ErrorCode.STORAGE_READ_ERROR, 'read app error');
      },
    };

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK }, deps);
    assert.equal(expectErrorCode(result), ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return CONFIG_NOT_FOUND when config is missing', async () => {
    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(expectErrorCode(result), ErrorCode.CONFIG_NOT_FOUND);
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when key cannot be loaded', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const config: EnvltConfig = {
      appName: 'envlt',
      envs: ['test'],
      keyId: 'missing',
    };
    expectOk(await writeConfig(config, projectRoot, adapter));

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(expectErrorCode(result), ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });

  void it('does return CRYPTO_DECRYPT_FAILED when existing encrypted env cannot be decrypted', async () => {
    await setupFixture();
    await fs.writeFile(path.join(projectRoot, '.env.test.enc'), 'not-encrypted', 'utf8');

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(expectErrorCode(result), ErrorCode.CRYPTO_DECRYPT_FAILED);
  });

  void it('does update encrypted variables when editor exits 0 and deletes temp file', async () => {
    const key = await setupFixture();
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeEncEnv('test', { FOO: 'original' }, key, projectRoot, adapter));

    const capturedPathFile = path.join(projectRoot, 'tmp-path.txt');
    process.env['ENVLT_CAPTURE_TMP_PATH'] = capturedPathFile;

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(result.ok, true);

    const vars = expectOk(await readEncEnv('test', key, projectRoot, adapter));
    assert.deepEqual(vars, { FOO: 'edited' });

    const tempPath = await fs.readFile(capturedPathFile, 'utf8');
    await assert.rejects(fs.access(tempPath));
  });

  void it('does discard changes when editor exits non-zero and deletes temp file', async () => {
    const key = await setupFixture();
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeEncEnv('test', { FOO: 'original' }, key, projectRoot, adapter));

    const capturedPathFile = path.join(projectRoot, 'tmp-path.txt');
    process.env['ENVLT_CAPTURE_TMP_PATH'] = capturedPathFile;

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_ABORT });
    assert.equal(result.ok, true);

    const vars = expectOk(await readEncEnv('test', key, projectRoot, adapter));
    assert.deepEqual(vars, { FOO: 'original' });

    const tempPath = await fs.readFile(capturedPathFile, 'utf8');
    await assert.rejects(fs.access(tempPath));
  });

  void it('does create temp file with 0o600 permissions', async () => {
    await setupFixture();
    const capturedModeFile = path.join(projectRoot, 'tmp-mode.txt');

    process.env['ENVLT_CAPTURE_TMP_MODE'] = capturedModeFile;

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(result.ok, true);

    const modeText = await fs.readFile(capturedModeFile, 'utf8');
    assert.equal(Number(modeText) & MODE_MASK, SECURE_FILE_MODE);
  });

  void it('does fall back to vi when editor override and env vars are absent', async () => {
    const key = await setupFixture();
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeEncEnv('test', { FOO: 'original' }, key, projectRoot, adapter));

    const binDir = path.join(projectRoot, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const viPath = path.join(binDir, 'vi');
    await fs.writeFile(viPath, '#!/bin/sh\necho "FOO=edited" > "$1"\nexit 0\n', { mode: 0o755 });
    await fs.chmod(viPath, 0o755);
    process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;

    const result = await runEdit({ env: 'test', projectRoot });
    assert.equal(result.ok, true);

    const vars = expectOk(await readEncEnv('test', key, projectRoot, adapter));
    assert.deepEqual(vars, { FOO: 'edited' });
  });

  void it('does prioritize options.editor over EDITOR environment variable', async () => {
    const key = await setupFixture();
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeEncEnv('test', { FOO: 'original' }, key, projectRoot, adapter));

    process.env['EDITOR'] = FIXTURE_EDITOR_ABORT;

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(result.ok, true);

    const vars = expectOk(await readEncEnv('test', key, projectRoot, adapter));
    assert.deepEqual(vars, { FOO: 'edited' });
  });

  void it('does return EDIT_EDITOR_NOT_FOUND when editor command does not exist', async () => {
    await setupFixture();

    const result = await runEdit({ env: 'test', projectRoot, editor: '__missing_editor__' });
    assert.equal(expectErrorCode(result), ErrorCode.EDIT_EDITOR_NOT_FOUND);
  });

  void it('does return ENVFILE_PARSE_ERROR when edited content is invalid and keep original vars', async () => {
    const key = await setupFixture();
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeEncEnv('test', { FOO: 'original' }, key, projectRoot, adapter));

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_INVALID });
    assert.equal(expectErrorCode(result), ErrorCode.ENVFILE_PARSE_ERROR);

    const vars = expectOk(await readEncEnv('test', key, projectRoot, adapter));
    assert.deepEqual(vars, { FOO: 'original' });
  });

  void it('does reject when env name is invalid', async () => {
    await setupFixture();

    await assert.rejects(
      runEdit({ env: 'INVALID_ENV', projectRoot, editor: FIXTURE_EDITOR_OK }),
      (error: unknown) =>
        error instanceof AppError && error.code === ErrorCode.ENVFILE_INVALID_ENV_NAME,
    );
  });

  void it('does return STORAGE_READ_ERROR when editor deletes temp file and does log cleanup warning', async () => {
    await setupFixture();
    const warnStub = sinon.stub(logger, 'warn');

    const result = await runEdit({
      env: 'test',
      projectRoot,
      editor: path.resolve('tests/fixtures/fake-editor-delete.sh'),
    });

    assert.equal(expectErrorCode(result), ErrorCode.STORAGE_READ_ERROR);
    assert.equal(warnStub.calledWith('Warning: failed to remove temporary edit file'), true);
  });

  void it('does create env file when no encrypted file exists', async () => {
    const key = await setupFixture();
    const adapter = createFilesystemAdapter(projectRoot);

    const result = await runEdit({ env: 'test', projectRoot, editor: FIXTURE_EDITOR_OK });
    assert.equal(result.ok, true);

    const vars = expectOk(await readEncEnv('test', key, projectRoot, adapter));
    assert.deepEqual(vars, { FOO: 'edited' });
  });
});
