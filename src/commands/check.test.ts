import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import sinon from 'sinon';

import { EXIT_CODES } from '../constants.js';
import { writeConfig, type EnvltConfig } from '../config.js';
import { writeEncEnv } from '../envfile.js';
import { generateKey } from '../crypto.js';
import { saveKey } from '../keystore.js';
import { logger } from '../logger.js';
import { writeManifest, type Manifest } from '../manifest.js';
import type { Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';

import { runCheck } from './check.js';

let projectRoot = '';
let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalExitCode: typeof process.exitCode;

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

async function setupConfigAndKey(keyId: string, keyHex: string): Promise<void> {
  const config: EnvltConfig = {
    appName: 'check-test',
    envs: ['staging', 'production'],
    keyId,
  };
  const adapter = createFilesystemAdapter(projectRoot);
  expectOk(await writeConfig(config, projectRoot, adapter));
  expectOk(await saveKey(keyId, keyHex, projectRoot));
}

async function writeManifestFile(manifest: Manifest): Promise<void> {
  const adapter = createFilesystemAdapter(projectRoot);
  expectOk(await writeManifest(manifest, projectRoot, adapter));
}

beforeEach(async () => {
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  originalExitCode = process.exitCode;
  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
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

  process.exitCode = originalExitCode;

  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('commands/check', () => {
  void it('does return error when config is missing', async () => {
    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.equal(result.ok, false);
  });

  void it('does return key loading error when key is missing', async () => {
    const config: EnvltConfig = {
      appName: 'check-test',
      envs: ['staging'],
      keyId: 'missing',
    };
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeConfig(config, projectRoot, adapter));

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.equal(result.ok, false);
  });

  void it('does return invalid env error for invalid env name', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });

    const result = await runCheck({ env: 'INVALID_ENV', projectRoot, exitOnFailure: false });
    assert.equal(result.ok, false);
  });

  void it('does return error when manifest is malformed', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await fs.writeFile(path.join(projectRoot, 'envlt.manifest.json'), '{broken', 'utf8');

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.equal(result.ok, false);
  });

  void it('does set process exitCode when missing required vars and exitOnFailure is true', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });

    process.exitCode = 0;
    const result = await runCheck({ env: 'staging', projectRoot });

    assert.deepEqual(expectOk(result), [{ key: 'DATABASE_URL', type: 'missing_required' }]);
    assert.equal(process.exitCode, EXIT_CODES.CHECK_FAILED);
  });

  void it('does return error when encrypted env file cannot be decrypted', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });

    await fs.writeFile(path.join(projectRoot, '.env.staging.enc'), 'not-encrypted', 'utf8');

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.equal(result.ok, false);
  });

  void it('does return empty violations and log success when all required vars are present', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });
    expectOk(
      await writeEncEnv(
        'staging',
        { DATABASE_URL: 'postgres://localhost/db' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    const successStub = sinon.stub(logger, 'success');
    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });

    assert.deepEqual(expectOk(result), []);
    assert.equal(successStub.calledWith('✓ All declared variables are set'), true);
  });

  void it('does return missing violation and log failure message', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });

    const errorStub = sinon.stub(logger, 'error');
    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });

    assert.deepEqual(expectOk(result), [{ key: 'DATABASE_URL', type: 'missing_required' }]);
    assert.equal(errorStub.calledWith('✗ DATABASE_URL — declared but not set'), true);
  });

  void it('does not set check failure exit code when exitOnFailure is false', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });

    process.exitCode = 0;
    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });

    assert.deepEqual(expectOk(result), [{ key: 'DATABASE_URL', type: 'missing_required' }]);
    assert.equal(process.exitCode, 0);
  });

  void it('does set check failure exit code for undeclared violations in strict mode', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });
    expectOk(
      await writeEncEnv(
        'staging',
        { DATABASE_URL: 'postgres://localhost/db', RANDOM_KEY: '1' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    process.exitCode = 0;
    const result = await runCheck({ env: 'staging', projectRoot, strict: true });

    assert.deepEqual(expectOk(result), [{ key: 'RANDOM_KEY', type: 'undeclared' }]);
    assert.equal(process.exitCode, EXIT_CODES.CHECK_FAILED);
  });

  void it('does not set check failure exit code for undeclared violations when exitOnFailure is false', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });
    expectOk(
      await writeEncEnv(
        'staging',
        { DATABASE_URL: 'postgres://localhost/db', RANDOM_KEY: '1' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    process.exitCode = 0;
    const result = await runCheck({
      env: 'staging',
      projectRoot,
      strict: true,
      exitOnFailure: false,
    });

    assert.deepEqual(expectOk(result), [{ key: 'RANDOM_KEY', type: 'undeclared' }]);
    assert.equal(process.exitCode, 0);
  });

  void it('does report undeclared vars in strict mode', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });
    expectOk(
      await writeEncEnv(
        'staging',
        { DATABASE_URL: 'postgres://localhost/db', RANDOM_KEY: '1' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    const result = await runCheck({
      env: 'staging',
      projectRoot,
      strict: true,
      exitOnFailure: false,
    });
    assert.deepEqual(expectOk(result), [{ key: 'RANDOM_KEY', type: 'undeclared' }]);
  });

  void it('does report required vars as missing when env file does not exist', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    });

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.deepEqual(expectOk(result), [{ key: 'DATABASE_URL', type: 'missing_required' }]);
  });

  void it('does not report entries filtered to other envs', async () => {
    const key = generateKey();
    await setupConfigAndKey('main', key);
    await writeManifestFile({
      version: 1,
      entries: [
        {
          key: 'PROD_ONLY',
          description: 'prod only',
          required: true,
          secret: true,
          envs: ['production'],
        },
      ],
    });

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.deepEqual(expectOk(result), []);
  });

  void it('does return no pair violations when both required pair keys are set', async () => {
    const key = generateKey();
    const config: EnvltConfig = {
      appName: 'check-test',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
    };
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeConfig(config, projectRoot, adapter));
    expectOk(await saveKey('main', key, projectRoot));

    await writeManifestFile({ version: 1, entries: [] });
    expectOk(
      await writeEncEnv(
        'staging',
        { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PUBLIC_KEY: 'pk_test' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.deepEqual(expectOk(result), []);
  });

  void it('does return missing_pair when only first required pair key is set', async () => {
    const key = generateKey();
    const config: EnvltConfig = {
      appName: 'check-test',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
    };
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeConfig(config, projectRoot, adapter));
    expectOk(await saveKey('main', key, projectRoot));

    await writeManifestFile({ version: 1, entries: [] });
    expectOk(
      await writeEncEnv(
        'staging',
        { STRIPE_SECRET_KEY: 'sk_test' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    const errorStub = sinon.stub(logger, 'error');
    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });

    assert.deepEqual(expectOk(result), [
      {
        type: 'missing_pair',
        presentKey: 'STRIPE_SECRET_KEY',
        missingKey: 'STRIPE_PUBLIC_KEY',
      },
    ]);
    assert.equal(
      errorStub.calledWith('✗ STRIPE_SECRET_KEY is set but STRIPE_PUBLIC_KEY is missing'),
      true,
    );
  });

  void it('does return missing_pair when only second required pair key is set', async () => {
    const key = generateKey();
    const config: EnvltConfig = {
      appName: 'check-test',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
    };
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeConfig(config, projectRoot, adapter));
    expectOk(await saveKey('main', key, projectRoot));

    await writeManifestFile({ version: 1, entries: [] });
    expectOk(
      await writeEncEnv(
        'staging',
        { STRIPE_PUBLIC_KEY: 'pk_test' },
        key,
        projectRoot,
        createFilesystemAdapter(projectRoot),
      ),
    );

    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });

    assert.deepEqual(expectOk(result), [
      {
        type: 'missing_pair',
        presentKey: 'STRIPE_PUBLIC_KEY',
        missingKey: 'STRIPE_SECRET_KEY',
      },
    ]);
  });

  void it('does return no pair violations when neither required pair key is set', async () => {
    const key = generateKey();
    const config: EnvltConfig = {
      appName: 'check-test',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
    };
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(await writeConfig(config, projectRoot, adapter));
    expectOk(await saveKey('main', key, projectRoot));

    await writeManifestFile({ version: 1, entries: [] });
    const result = await runCheck({ env: 'staging', projectRoot, exitOnFailure: false });
    assert.deepEqual(expectOk(result), []);
  });
});
