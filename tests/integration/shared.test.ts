import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { encrypt } from '../../src/crypto.js';

import { ensureIntegrationBuild } from './build.js';

const DIST_BIN_PATH = path.resolve('dist/bin/envlt.js');
const KEY = 'f'.repeat(64);

let projectRoot = '';
let tempHome = '';

async function runGit(args: readonly string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', [...args], { ...(cwd !== undefined ? { cwd } : {}) });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr));
    });
    child.on('error', (error: Error) => {
      reject(error);
    });
  });
}

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

async function writeSharedCache(sharedVars: Readonly<Record<string, string>>): Promise<void> {
  const remoteBare = path.join(tempHome, 'remote-shared.git');
  const worktree = path.join(tempHome, 'remote-worktree');
  const repoDir = path.join(tempHome, '.envlt', 'cache', 'org__repo');
  const filePath = path.join(worktree, 'shared', 'base.enc');

  await runGit(['init', '--bare', remoteBare]);
  await runGit(['clone', remoteBare, worktree]);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const plaintext = `${Object.entries(sharedVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  await fs.writeFile(filePath, encrypt(plaintext, KEY), 'utf8');

  await runGit(['add', '.'], worktree);
  await runGit(
    ['-c', 'user.name=envlt', '-c', 'user.email=envlt@example.com', 'commit', '-m', 'seed'],
    worktree,
  );
  await runGit(['push', 'origin', 'HEAD'], worktree);
  await runGit(['clone', remoteBare, repoDir]);
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
      envs: ['test'],
      keyId: 'main',
      extends: ['github:org/repo/shared/base'],
    },
    null,
    2,
  );
  await fs.writeFile(path.join(projectRoot, 'envlt.config.json'), `${configText}\n`, 'utf8');

  const keysDir = path.join(projectRoot, '.envlt', 'keys');
  await fs.mkdir(keysDir, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(projectRoot, '.envlt'), 0o700);
  await fs.chmod(keysDir, 0o700);
  await fs.writeFile(path.join(keysDir, 'main'), KEY, { mode: 0o600 });
  await fs.chmod(path.join(keysDir, 'main'), 0o600);

  await writeSharedCache({ SHARED_ONLY: 'on', SAME: 'shared' });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('integration/shared', () => {
  void it('does inject shared vars into envlt use command', async () => {
    const baseEnv = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };

    const setResult = await runCli(['set', 'LOCAL_ONLY=ok', '--env', 'test'], baseEnv);
    assert.equal(setResult.code, 0);

    const useResult = await runCli(
      [
        'use',
        '--env',
        'test',
        '--',
        process.execPath,
        '-e',
        "process.stdout.write((process.env['SHARED_ONLY'] ?? '') + '|' + (process.env['LOCAL_ONLY'] ?? ''))",
      ],
      baseEnv,
    );

    assert.equal(useResult.code, 0);
    assert.equal(useResult.stdout, 'on|ok');
  });

  void it('does let local vars override shared vars', async () => {
    const baseEnv = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };
    const setResult = await runCli(['set', 'SAME=local', '--env', 'test'], baseEnv);
    assert.equal(setResult.code, 0);

    const useResult = await runCli(
      [
        'use',
        '--env',
        'test',
        '--',
        process.execPath,
        '-e',
        "process.stdout.write(process.env['SAME'] ?? '')",
      ],
      baseEnv,
    );

    assert.equal(useResult.code, 0);
    assert.equal(useResult.stdout, 'local');
  });

  void it('does continue in non-strict mode when extends is broken', async () => {
    const baseEnv = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };
    await fs.rm(path.join(tempHome, '.envlt', 'cache', 'org__repo', 'shared', 'base.enc'), {
      force: true,
    });

    const setResult = await runCli(['set', 'LOCAL_ONLY=ok', '--env', 'test'], baseEnv);
    assert.equal(setResult.code, 0);

    const useResult = await runCli(
      [
        'use',
        '--env',
        'test',
        '--',
        process.execPath,
        '-e',
        "process.stdout.write(process.env['LOCAL_ONLY'] ?? '')",
      ],
      baseEnv,
    );

    assert.equal(useResult.code, 0);
    assert.equal(useResult.stdout, 'ok');
    assert.match(useResult.stderr, /Shared secrets unavailable/u);
  });
});
