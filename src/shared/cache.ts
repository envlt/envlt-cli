import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

export type GitRunner = (args: readonly string[], cwd?: string) => Promise<Result<string>>;

const CACHE_DIRECTORY_MODE = 0o700;
const GIT_TIMEOUT_MS = 30_000;
const GITHUB_HOST = 'github.com';

function getDefaultCacheRoot(): string {
  return path.resolve(os.homedir(), '.envlt', 'cache');
}

function getRepoCacheDirectory(cacheRoot: string, org: string, repo: string): string {
  return path.resolve(cacheRoot, `${org}__${repo}`);
}

async function ensureCacheRoot(cacheRoot: string): Promise<Result<void>> {
  try {
    await fs.mkdir(cacheRoot, { recursive: true, mode: CACHE_DIRECTORY_MODE });
    await fs.chmod(cacheRoot, CACHE_DIRECTORY_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to prepare shared cache.', error),
    );
  }
}

function defaultGitRunner(args: readonly string[], cwd?: string): Promise<Result<string>> {
  return new Promise((resolve) => {
    const git = spawn('git', [...args], {
      ...(cwd !== undefined ? { cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      git.kill('SIGKILL');
    }, GIT_TIMEOUT_MS);

    git.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    git.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    git.on('error', (error: Error) => {
      clearTimeout(timeout);
      resolve(
        err(new AppError(ErrorCode.SHARED_GIT_ERROR, 'Failed to execute git operation.', error)),
      );
    });

    git.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (didTimeout) {
        resolve(err(new AppError(ErrorCode.SHARED_TIMEOUT, 'Shared git operation timed out.')));
        return;
      }

      if (code !== 0) {
        resolve(
          err(
            new AppError(
              ErrorCode.SHARED_GIT_ERROR,
              'Git operation for shared secrets failed.',
              stderr.trim() === '' ? undefined : stderr.trim(),
            ),
          ),
        );
        return;
      }

      resolve(ok(stdout));
    });
  });
}

async function ensureCachedRepoWithRunner(
  org: string,
  repo: string,
  cacheDir: string | undefined,
  gitRunner: GitRunner,
): Promise<Result<string>> {
  const cacheRoot = cacheDir ?? getDefaultCacheRoot();
  const cacheRootResult = await ensureCacheRoot(cacheRoot);
  if (!cacheRootResult.ok) {
    return cacheRootResult;
  }

  const repoCacheDir = getRepoCacheDirectory(cacheRoot, org, repo);
  let repoExists = false;
  try {
    await fs.access(repoCacheDir);
    repoExists = true;
  } catch {
    repoExists = false;
  }

  if (!repoExists) {
    const cloneResult = await gitRunner(
      ['clone', `git@${GITHUB_HOST}:${org}/${repo}.git`, repoCacheDir],
      cacheRoot,
    );
    if (!cloneResult.ok) {
      return cloneResult;
    }

    return ok(repoCacheDir);
  }

  const pullResult = await gitRunner(['-C', repoCacheDir, 'pull', '--ff-only']);
  if (!pullResult.ok) {
    return pullResult;
  }

  return ok(repoCacheDir);
}

export async function ensureCachedRepo(
  org: string,
  repo: string,
  cacheDir?: string,
  gitRunner: GitRunner = defaultGitRunner,
): Promise<Result<string>> {
  return ensureCachedRepoWithRunner(org, repo, cacheDir, gitRunner);
}

export async function clearCachedRepo(org: string, repo: string): Promise<Result<void>> {
  const repoCacheDir = getRepoCacheDirectory(getDefaultCacheRoot(), org, repo);
  try {
    await fs.rm(repoCacheDir, { recursive: true, force: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_DELETE_ERROR, 'Failed to clear shared cache repo.', error),
    );
  }
}

export async function clearAllCache(): Promise<Result<void>> {
  const cacheRoot = getDefaultCacheRoot();
  try {
    await fs.rm(cacheRoot, { recursive: true, force: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_DELETE_ERROR, 'Failed to clear shared cache.', error),
    );
  }
}
