import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const DIST_BIN_PATH = path.resolve('dist/bin/envlt.js');
const REPO_ROOT = path.resolve('.');

let projectRoot = '';
let tempHome = '';
let isBuilt = false;

async function runBuild(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Build failed with exit code ${String(code)}`));
    });
  });
}

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
  if (!isBuilt) {
    await runBuild();
    isBuilt = true;
  }

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

  const keysDir = path.join(tempHome, '.envlt', 'keys');
  await fs.mkdir(keysDir, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(tempHome, '.envlt'), 0o700);
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
    const baseEnv = { ...process.env, HOME: tempHome, ENVLT_KEY: 'sensitive' };

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
});
