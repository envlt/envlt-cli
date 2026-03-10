import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve('.');
const BUILD_LOCK_DIR = path.join(os.tmpdir(), 'envlt-integration-build.lock');
const DIST_BIN_PATH = path.join(REPO_ROOT, 'dist', 'bin', 'envlt.js');
const SOURCE_DIRS = [path.join(REPO_ROOT, 'bin'), path.join(REPO_ROOT, 'src')] as const;
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

async function collectLatestMtimeMs(dirPath: string): Promise<number> {
  let latestMtimeMs = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const childLatest = await collectLatestMtimeMs(fullPath);
        if (childLatest > latestMtimeMs) {
          latestMtimeMs = childLatest;
        }
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs > latestMtimeMs) {
        latestMtimeMs = stat.mtimeMs;
      }
    }),
  );

  return latestMtimeMs;
}

async function latestSourceMtimeMs(): Promise<number> {
  let latest = 0;

  await Promise.all(
    SOURCE_DIRS.map(async (dirPath) => {
      const dirLatest = await collectLatestMtimeMs(dirPath);
      if (dirLatest > latest) {
        latest = dirLatest;
      }
    }),
  );

  return latest;
}

async function hasUsableBuild(): Promise<boolean> {
  try {
    const [distStat, latestSourceMtime] = await Promise.all([
      fs.stat(DIST_BIN_PATH),
      latestSourceMtimeMs(),
    ]);
    return distStat.mtimeMs >= latestSourceMtime;
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
    isBuiltInProcess = true;
  } finally {
    await fs.rm(BUILD_LOCK_DIR, { recursive: true, force: true });
  }
}
