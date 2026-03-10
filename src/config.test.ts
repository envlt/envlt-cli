import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { readConfig, validateConfig, writeConfig, type EnvltConfig } from './config.js';
import { AppError, ErrorCode } from './errors.js';
import { type Result } from './result.js';
import { createFilesystemAdapter } from './storage/index.js';

let projectRoot: string;

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function expectErrCode<T>(result: Result<T>): ErrorCode {
  if (result.ok) {
    throw new Error('Expected error result.');
  }

  if (!(result.error instanceof AppError)) {
    throw new Error('Expected AppError.');
  }

  return result.error.code;
}

beforeEach(async () => {
  projectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

void describe('config', () => {
  void it('does round-trip writeConfig and readConfig', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const config: EnvltConfig = {
      appName: 'payments',
      envs: ['staging', 'production'],
      extends: ['github:acme/platform/shared/envs.json'],
      requiredPairs: [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
      customDictionary: ['PAYMENTS_KEY'],
      keyId: 'default_key',
    };

    expectOk(await writeConfig(config, projectRoot, adapter));
    assert.deepEqual(expectOk(await readConfig(projectRoot, adapter)), config);
  });

  void it('does return CONFIG_INVALID from validateConfig for unknown fields', () => {
    const result = validateConfig({
      appName: 'app',
      envs: ['staging'],
      keyId: 'main',
      extra: true,
    });
    assert.equal(expectErrCode(result), ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID from validateConfig for invalid requiredPairs', () => {
    const wrongTupleLength = validateConfig({
      appName: 'app',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['ONLY_ONE']],
    });
    assert.equal(expectErrCode(wrongTupleLength), ErrorCode.CONFIG_INVALID);

    const wrongKeyFormat = validateConfig({
      appName: 'app',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['STRIPE_SECRET_KEY', 'stripe_public_key']],
    });
    assert.equal(expectErrCode(wrongKeyFormat), ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID from validateConfig for invalid customDictionary', () => {
    const nonStringEntry = validateConfig({
      appName: 'app',
      envs: ['staging'],
      keyId: 'main',
      customDictionary: ['GOOD', 42],
    });
    assert.equal(expectErrCode(nonStringEntry), ErrorCode.CONFIG_INVALID);

    const invalidKeyFormat = validateConfig({
      appName: 'app',
      envs: ['staging'],
      keyId: 'main',
      customDictionary: ['GOOD_KEY', 'bad_key'],
    });
    assert.equal(expectErrCode(invalidKeyFormat), ErrorCode.CONFIG_INVALID);

    const emptyEntry = validateConfig({
      appName: 'app',
      envs: ['staging'],
      keyId: 'main',
      customDictionary: ['GOOD_KEY', ''],
    });
    assert.equal(expectErrCode(emptyEntry), ErrorCode.CONFIG_INVALID);
  });

  void it('does return STORAGE_READ_ERROR when adapter exists throws', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> => Promise.reject(new Error('not implemented')),
      write: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
      exists: (): Promise<Result<boolean>> => Promise.reject(new Error('exists exploded')),
      delete: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
    };

    const result = await readConfig(projectRoot, adapter);
    assert.equal(expectErrCode(result), ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return STORAGE_READ_ERROR when adapter read throws', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> => Promise.reject(new Error('read exploded')),
      write: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
      exists: (): Promise<Result<boolean>> => Promise.resolve({ ok: true, value: true }),
      delete: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
    };

    const result = await readConfig(projectRoot, adapter);
    assert.equal(expectErrCode(result), ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return STORAGE_WRITE_ERROR when adapter write throws', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> => Promise.reject(new Error('not implemented')),
      write: (): Promise<Result<void>> => Promise.reject(new Error('write exploded')),
      exists: (): Promise<Result<boolean>> => Promise.reject(new Error('not implemented')),
      delete: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
    };

    const result = await writeConfig(
      { appName: 'app', envs: ['staging'], keyId: 'main' },
      projectRoot,
      adapter,
    );
    assert.equal(expectErrCode(result), ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return storage error when config existence check fails', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> => Promise.reject(new Error('not implemented')),
      write: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
      exists: (): Promise<Result<boolean>> =>
        Promise.resolve({
          ok: false,
          error: new AppError(ErrorCode.STORAGE_READ_ERROR, 'cannot check exists'),
        }),
      delete: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
    };

    const result = await readConfig(projectRoot, adapter);
    assert.equal(expectErrCode(result), ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return storage error when reading config fails', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> =>
        Promise.resolve({
          ok: false,
          error: new AppError(ErrorCode.STORAGE_READ_ERROR, 'read failed'),
        }),
      write: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
      exists: (): Promise<Result<boolean>> => Promise.resolve({ ok: true, value: true }),
      delete: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
    };

    const result = await readConfig(projectRoot, adapter);
    assert.equal(expectErrCode(result), ErrorCode.STORAGE_READ_ERROR);
  });

  void it('does return CONFIG_NOT_FOUND when config file is missing', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    assert.equal(expectErrCode(await readConfig(projectRoot, adapter)), ErrorCode.CONFIG_NOT_FOUND);
  });

  void it('does return CONFIG_INVALID when config contains invalid JSON', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'envlt.config.json'), '{ invalid json ', 'utf8');

    assert.equal(expectErrCode(await readConfig(projectRoot, adapter)), ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID when required fields are missing', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      JSON.stringify({ appName: 'app' }),
      'utf8',
    );

    assert.equal(expectErrCode(await readConfig(projectRoot, adapter)), ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID when envs include invalid entry', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      JSON.stringify({ appName: 'app', envs: ['staging', 'PROD'], keyId: 'main' }),
      'utf8',
    );

    assert.equal(expectErrCode(await readConfig(projectRoot, adapter)), ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID when extends include invalid format', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      JSON.stringify({
        appName: 'app',
        envs: ['staging'],
        keyId: 'main',
        extends: ['gitlab:org/repo/path'],
      }),
      'utf8',
    );

    assert.equal(expectErrCode(await readConfig(projectRoot, adapter)), ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID when appName is empty', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      JSON.stringify({ appName: '', envs: ['staging'], keyId: 'main' }),
      'utf8',
    );

    assert.equal(expectErrCode(await readConfig(projectRoot, adapter)), ErrorCode.CONFIG_INVALID);
  });
});
