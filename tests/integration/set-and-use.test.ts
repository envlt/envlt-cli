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
    { appName: 'envlt-e2e', envs: ['test'], keyId: 'main' },
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

void describe('integration/set-and-use', () => {
  void it('does run set then use end to end with built binary', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      ENVLT_KEY: 'sensitive',
    };

    const setResult = await runCli(['set', 'FOO=bar', 'BAZ=qux', '--env', 'test'], baseEnv);
    assert.equal(setResult.code, 0);

    const encPath = path.join(projectRoot, '.env.test.enc');
    const stats = await fs.stat(encPath);
    assert.equal(stats.isFile(), true);

    const useResult = await runCli(
      [
        'use',
        '--env',
        'test',
        '--',
        process.execPath,
        '-e',
        "process.stdout.write((process.env['FOO'] ?? '') + '|' + (process.env['ENVLT_KEY'] ?? ''))",
      ],
      baseEnv,
    );
    assert.equal(useResult.code, 0);
    assert.equal(useResult.stdout, 'bar|');
  });

  void it('does show debug output only when verbose is enabled', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    };

    const setDefaultResult = await runCli(['set', 'FOO=bar', '--env', 'test'], baseEnv);
    assert.equal(setDefaultResult.code, 0);
    assert.doesNotMatch(setDefaultResult.stdout, /Writing \d+ variable\(s\)/u);

    const setVerboseResult = await runCli(
      ['--verbose', 'set', 'BAR=baz', '--env', 'test'],
      baseEnv,
    );
    assert.equal(setVerboseResult.code, 0);
    assert.match(setVerboseResult.stdout, /Writing 2 variable\(s\) to \.env\.test\.enc/u);

    const useVerboseResult = await runCli(
      ['-v', 'use', '--env', 'test', '--', process.execPath, '-e', "process.stdout.write('1')"],
      baseEnv,
    );
    assert.equal(useVerboseResult.code, 0);
    assert.match(useVerboseResult.stdout, /Spawning: .*node/u);
    assert.match(useVerboseResult.stdout, /1/u);
  });

  void it('does fail when set receives invalid key format', async () => {
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    };

    const setResult = await runCli(['set', 'invalid_key=value', '--env', 'test'], baseEnv);
    assert.notEqual(setResult.code, 0);
    assert.match(setResult.stderr, /Expected UPPER_SNAKE_CASE format/u);
  });
});
