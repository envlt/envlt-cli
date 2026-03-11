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
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DIST_BIN_PATH, ...args], { cwd: projectRoot, env });
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout });
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
    { appName: 'envlt-e2e', envs: ['staging'], keyId: 'main' },
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

void describe('integration/declare-and-check', () => {
  void it('does declare then enforce check until variable is set', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    };

    const declareResult = await runCli(
      ['declare', 'DATABASE_URL', '--description', 'PostgreSQL URL', '--env', 'staging'],
      baseEnv,
    );
    assert.equal(declareResult.code, 0);

    const manifestPath = path.join(projectRoot, 'envlt.manifest.json');
    const manifestText = await fs.readFile(manifestPath, 'utf8');
    assert.ok(manifestText.includes('DATABASE_URL'));

    const checkMissing = await runCli(['check', '--env', 'staging'], baseEnv);
    assert.equal(checkMissing.code, EXIT_CODES.CHECK_FAILED);

    const setResult = await runCli(
      ['set', 'DATABASE_URL=postgres://db', '--env', 'staging'],
      baseEnv,
    );
    assert.equal(setResult.code, 0);

    const checkOk = await runCli(['check', '--env', 'staging'], baseEnv);
    assert.equal(checkOk.code, EXIT_CODES.SUCCESS);
  });
});
