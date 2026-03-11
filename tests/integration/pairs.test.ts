import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { EXIT_CODES } from '../../src/constants.js';

import { ensureIntegrationBuild } from './build.js';

const DIST_BIN_PATH = path.resolve('dist/bin/envlt.js');

let projectRoot = '';
let tempHome = '';

async function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DIST_BIN_PATH, ...args], { cwd: projectRoot, env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

beforeEach(async () => {
  await ensureIntegrationBuild();

  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });

  const configText = JSON.stringify(
    {
      appName: 'envlt-e2e',
      envs: ['staging'],
      keyId: 'main',
      requiredPairs: [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
    },
    null,
    2,
  );
  await fs.writeFile(path.join(projectRoot, 'envlt.config.json'), `${configText}\n`, 'utf8');

  const keysDir = path.join(projectRoot, '.envlt', 'keys');
  await fs.mkdir(keysDir, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(projectRoot, '.envlt'), 0o700);
  await fs.chmod(keysDir, 0o700);
  await fs.writeFile(path.join(keysDir, 'main'), 'a'.repeat(64), { mode: 0o600 });
  await fs.chmod(path.join(keysDir, 'main'), 0o600);
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('integration/pairs', () => {
  void it('does fail check until required pair partner key is set', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    };

    const setSecretResult = await runCli(
      ['set', 'STRIPE_SECRET_KEY=sk_test_123', '--env', 'staging'],
      baseEnv,
    );
    assert.equal(setSecretResult.code, EXIT_CODES.SUCCESS);

    const checkMissingPair = await runCli(['check', '--env', 'staging'], baseEnv);
    assert.equal(checkMissingPair.code, EXIT_CODES.CHECK_FAILED);
    assert.match(checkMissingPair.stderr, /STRIPE_PUBLIC_KEY/u);

    const setPublicResult = await runCli(
      ['set', 'STRIPE_PUBLIC_KEY=pk_test_123', '--env', 'staging'],
      baseEnv,
    );
    assert.equal(setPublicResult.code, EXIT_CODES.SUCCESS);

    const checkSuccess = await runCli(['check', '--env', 'staging'], baseEnv);
    assert.equal(checkSuccess.code, EXIT_CODES.SUCCESS);
  });
});
