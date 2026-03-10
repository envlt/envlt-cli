import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve('.');
const BUILD_LOCK_DIR = path.join(os.tmpdir(), 'envlt-integration-build.lock');
const BUILD_DONE_FILE = path.join(os.tmpdir(), 'envlt-integration-build.done');
const DIST_BIN_PATH = path.join(REPO_ROOT, 'dist', 'bin', 'envlt.js');
const LOCK_RETRY_MS = 50;

let isBuiltInProcess = false;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runBuild(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    let settled = false;

    child.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Build failed with exit code ${String(code)}`));
    });
  });
}

async function hasUsableBuild(): Promise<boolean> {
  try {
    await fs.access(BUILD_DONE_FILE);
    await fs.access(DIST_BIN_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function ensureIntegrationBuild(): Promise<void> {
  if (isBuiltInProcess) {
    return;
  }

  if (await hasUsableBuild()) {
    isBuiltInProcess = true;
    return;
  }

  for (;;) {
    try {
      await fs.mkdir(BUILD_LOCK_DIR);
      break;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        if (await hasUsableBuild()) {
          isBuiltInProcess = true;
          return;
        }

        await wait(LOCK_RETRY_MS);
        continue;
      }

      throw error;
    }
  }

  try {
    await runBuild();
    await fs.writeFile(BUILD_DONE_FILE, 'ok\n', 'utf8');
    isBuiltInProcess = true;
  } finally {
    await fs.rm(BUILD_LOCK_DIR, { recursive: true, force: true });
  }
}
