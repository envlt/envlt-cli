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
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DIST_BIN_PATH, ...args], {
      cwd: projectRoot,
      env: process.env,
    });

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
  if (!isBuilt) {
    await runBuild();
    isBuilt = true;
  }

  projectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

void describe('integration/hooks', () => {
  void it('does install, report status, and uninstall hook', async () => {
    const installResult = await runCli(['hooks', 'install']);
    assert.equal(installResult.code, 0);

    const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
    const hookContent = await fs.readFile(hookPath, 'utf8');
    const hookStat = await fs.stat(hookPath);
    assert.match(hookContent, /# envlt:pre-commit/u);
    assert.equal(hookStat.mode & 0o777, 0o755);

    const statusResult = await runCli(['hooks', 'status']);
    assert.equal(statusResult.code, 0);
    assert.match(statusResult.stdout, /installed/u);

    const uninstallResult = await runCli(['hooks', 'uninstall']);
    assert.equal(uninstallResult.code, 0);

    await assert.rejects(fs.access(hookPath));
  });
});
