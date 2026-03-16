import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

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
    { appName: 'envlt-e2e', envs: ['development', 'custom'], keyId: 'main' },
    null,
    2,
  );
  await fs.writeFile(path.join(projectRoot, 'envlt.config.json'), `${configText}\n`, 'utf8');

  const keysDir = path.join(projectRoot, '.envlt', 'keys');
  await fs.mkdir(keysDir, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(projectRoot, '.envlt'), 0o700);
  await fs.chmod(keysDir, 0o700);
  await fs.writeFile(path.join(keysDir, 'main'), 'f'.repeat(64), { mode: 0o600 });
  await fs.chmod(path.join(keysDir, 'main'), 0o600);
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('integration/verbose-flag', () => {
  void it('does show debug output for set when --verbose is provided', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      NO_COLOR: '1',
    };

    const result = await runCli(['--verbose', 'set', 'FOO=bar'], baseEnv);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Writing 1 variable\(s\) to \.env\.development\.enc/u);
    assert.equal(result.stderr, '');
  });

  void it('does show debug output for check when --verbose is provided', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      NO_COLOR: '1',
    };

    const seedResult = await runCli(['set', 'BAZ=qux'], baseEnv);
    assert.equal(seedResult.code, 0);

    const result = await runCli(['--verbose', 'check'], baseEnv);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Loaded \d+ variable\(s\) from \.env\.[a-z]+\.enc/u);
    assert.equal(result.stderr, '');
  });

  void it('does show debug output before child output for use with -v', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      NO_COLOR: '1',
    };

    const seedResult = await runCli(['set', 'FOO=bar'], baseEnv);
    assert.equal(seedResult.code, 0);

    const result = await runCli(
      ['-v', 'use', '--', process.execPath, '-e', "console.log('test')"],
      baseEnv,
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(
      result.stdout,
      new RegExp(`Spawning: ${process.execPath.replace(/\\/gu, '\\\\')}`),
    );

    const debugIndex = result.stdout.indexOf('Spawning:');
    const childIndex = result.stdout.indexOf('test');
    assert.notEqual(debugIndex, -1);
    assert.notEqual(childIndex, -1);
    assert.ok(debugIndex < childIndex);
  });

  void it('does not show debug output for set without verbose', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      NO_COLOR: '1',
    };

    const result = await runCli(['set', 'FOO=bar'], baseEnv);

    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /Writing \d+ variable\(s\) to /u);
  });

  void it('does not show debug output for set with custom env without verbose', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      NO_COLOR: '1',
    };

    const result = await runCli(['set', 'FOO=bar', '--env', 'custom'], baseEnv);

    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /Writing \d+ variable\(s\) to /u);
  });
});
