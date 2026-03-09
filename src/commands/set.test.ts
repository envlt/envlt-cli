import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { generateKey } from '../crypto.js';
import { writeConfig, type EnvltConfig } from '../config.js';
import { readEncEnv } from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { saveKey } from '../keystore.js';
import type { Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';

import { runSet } from './set.js';

let projectRoot = '';
let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

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

async function writeMinimalConfig(projectDir: string, keyId: string): Promise<void> {
  const config: EnvltConfig = {
    appName: 'envlt-test',
    envs: ['development', 'test'],
    keyId,
  };
  const adapter = createFilesystemAdapter(projectDir);
  expectOk(await writeConfig(config, projectDir, adapter));
}

beforeEach(async () => {
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });
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

  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('commands/set', () => {
  void it('does set a new variable in a non-existent file', async () => {
    const keyId = 'main';
    const key = generateKey();
    expectOk(await saveKey(keyId, key));
    await writeMinimalConfig(projectRoot, keyId);

    expectOk(await runSet(['FOO=bar'], { env: 'test', projectRoot }));

    const vars = expectOk(
      await readEncEnv('test', key, projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.deepEqual(vars, { FOO: 'bar' });
  });

  void it('does update an existing variable without touching others', async () => {
    const key = generateKey();
    expectOk(await saveKey('main', key));
    await writeMinimalConfig(projectRoot, 'main');
    expectOk(await runSet(['A=1', 'B=2'], { env: 'test', projectRoot }));

    expectOk(await runSet(['A=9'], { env: 'test', projectRoot }));

    const vars = expectOk(
      await readEncEnv('test', key, projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.deepEqual(vars, { A: '9', B: '2' });
  });

  void it('does set multiple variables in one call', async () => {
    const key = generateKey();
    expectOk(await saveKey('main', key));
    await writeMinimalConfig(projectRoot, 'main');

    expectOk(await runSet(['FOO=bar', 'BAZ=qux'], { env: 'test', projectRoot }));

    const vars = expectOk(
      await readEncEnv('test', key, projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.deepEqual(vars, { BAZ: 'qux', FOO: 'bar' });
  });

  void it('does return SET_INVALID_ASSIGNMENT when assignment has no equals sign', async () => {
    expectOk(await saveKey('main', generateKey()));
    await writeMinimalConfig(projectRoot, 'main');

    const result = await runSet(['INVALID'], { env: 'test', projectRoot });
    assert.equal(expectErrorCode(result), ErrorCode.SET_INVALID_ASSIGNMENT);
  });

  void it('does return SET_INVALID_ASSIGNMENT when assignment key is empty', async () => {
    expectOk(await saveKey('main', generateKey()));
    await writeMinimalConfig(projectRoot, 'main');

    const result = await runSet(['=value'], { env: 'test', projectRoot });
    assert.equal(expectErrorCode(result), ErrorCode.SET_INVALID_ASSIGNMENT);
  });

  void it('does round-trip set then readEncEnv with updated vars', async () => {
    const key = generateKey();
    expectOk(await saveKey('main', key));
    await writeMinimalConfig(projectRoot, 'main');

    expectOk(await runSet(['HELLO=world'], { env: 'test', projectRoot }));

    const vars = expectOk(
      await readEncEnv('test', key, projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.equal(vars['HELLO'], 'world');
  });

  void it('does keep original file unchanged when atomic rename fails', async () => {
    const key = generateKey();
    expectOk(await saveKey('main', key));
    await writeMinimalConfig(projectRoot, 'main');
    expectOk(await runSet(['FOO=original'], { env: 'test', projectRoot }));

    const result = await runSet(
      ['FOO=updated'],
      { env: 'test', projectRoot },
      {
        writeFile: fs.writeFile,
        rename: () => Promise.reject(new Error('rename failed')),
        rm: fs.rm,
      },
    );

    assert.equal(expectErrorCode(result), ErrorCode.STORAGE_WRITE_ERROR);
    const vars = expectOk(
      await readEncEnv('test', key, projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.equal(vars['FOO'], 'original');
  });

  void it('does return KEYSTORE_KEY_NOT_FOUND when key does not exist', async () => {
    await writeMinimalConfig(projectRoot, 'missing-key');

    const result = await runSet(['FOO=bar'], { env: 'test', projectRoot });
    assert.equal(expectErrorCode(result), ErrorCode.KEYSTORE_KEY_NOT_FOUND);
  });
});
