import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

import { clearAllCache, clearCachedRepo, ensureCachedRepo, type GitRunner } from './cache.js';

let cacheRoot = '';
let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
  cacheRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
});

afterEach(async () => {
  await fs.rm(cacheRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }

  if (originalUserProfile === undefined) {
    delete process.env['USERPROFILE'];
  } else {
    process.env['USERPROFILE'] = originalUserProfile;
  }
});

void describe('shared/cache', () => {
  void it('does call git clone when cache dir does not exist', async () => {
    const calls: string[] = [];
    const runner: GitRunner = async (args: readonly string[]): Promise<Result<string>> => {
      calls.push(args.join(' '));
      const target = args.at(-1);
      if (target !== undefined) {
        await fs.mkdir(target, { recursive: true });
      }
      return ok('cloned');
    };

    const result = await ensureCachedRepo('my-org', 'secrets', cacheRoot, runner);
    assert.equal(result.ok, true);
    assert.match(calls[0] ?? '', /^clone /u);
  });

  void it('does call git pull when cache dir exists', async () => {
    const repoDir = path.join(cacheRoot, 'my-org__secrets');
    await fs.mkdir(repoDir, { recursive: true });
    const calls: string[] = [];
    const runner: GitRunner = (args: readonly string[]): Promise<Result<string>> => {
      calls.push(args.join(' '));
      return Promise.resolve(ok('updated'));
    };

    const result = await ensureCachedRepo('my-org', 'secrets', cacheRoot, runner);
    assert.equal(result.ok, true);
    assert.match(calls[0] ?? '', /^-C /u);
    assert.match(calls[0] ?? '', /pull --ff-only/u);
  });

  void it('does return SHARED_GIT_ERROR when git fails', async () => {
    const runner: GitRunner = (): Promise<Result<string>> =>
      Promise.resolve(err(new AppError(ErrorCode.SHARED_GIT_ERROR, 'git failed')));

    const result = await ensureCachedRepo('my-org', 'secrets', cacheRoot, runner);
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.SHARED_GIT_ERROR);
  });

  void it('does return SHARED_TIMEOUT when git hangs', async () => {
    const runner: GitRunner = (): Promise<Result<string>> =>
      Promise.resolve(err(new AppError(ErrorCode.SHARED_TIMEOUT, 'timed out')));

    const result = await ensureCachedRepo('my-org', 'secrets', cacheRoot, runner);
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.SHARED_TIMEOUT);
  });

  void it('does return SHARED_GIT_ERROR with default git runner when clone fails', async () => {
    const result = await ensureCachedRepo('missing-org', 'missing-repo', cacheRoot);
    if (result.ok) {
      assert.fail('Expected git failure result');
    }

    assert.equal(result.error.code, ErrorCode.SHARED_GIT_ERROR);
  });

  void it('does return STORAGE_WRITE_ERROR when cache root cannot be created', async () => {
    const invalidRoot = path.join(cacheRoot, 'cache-file');
    await fs.writeFile(invalidRoot, 'x', 'utf8');

    const result = await ensureCachedRepo('my-org', 'secrets', invalidRoot);
    if (result.ok) {
      assert.fail('Expected cache root creation failure');
    }

    assert.equal(result.error.code, ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return SHARED_GIT_ERROR when git binary cannot be spawned', async () => {
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '';

    try {
      const result = await ensureCachedRepo('my-org', 'secrets', cacheRoot);
      if (result.ok) {
        assert.fail('Expected git spawn failure');
      }

      assert.equal(result.error.code, ErrorCode.SHARED_GIT_ERROR);
    } finally {
      if (originalPath === undefined) {
        delete process.env['PATH'];
      } else {
        process.env['PATH'] = originalPath;
      }
    }
  });

  void it('does return SHARED_TIMEOUT when git process exceeds timeout', async () => {
    const fakeBinDir = path.join(cacheRoot, 'fake-bin');
    const fakeGit = path.join(fakeBinDir, 'git');
    await fs.mkdir(fakeBinDir, { recursive: true });
    await fs.writeFile(fakeGit, '#!/bin/sh\n/bin/sleep 31\n', { mode: 0o755 });
    await fs.chmod(fakeGit, 0o755);

    const originalPath = process.env['PATH'];
    process.env['PATH'] = fakeBinDir;

    try {
      const result = await ensureCachedRepo('my-org', 'secrets', cacheRoot);
      if (result.ok) {
        assert.fail('Expected timeout result');
      }

      assert.equal(result.error.code, ErrorCode.SHARED_TIMEOUT);
    } finally {
      if (originalPath === undefined) {
        delete process.env['PATH'];
      } else {
        process.env['PATH'] = originalPath;
      }
    }
  });

  void it('does delete single repo cache dir', async () => {
    const repoDir = path.join(tempHome, '.envlt', 'cache', 'org__repo');
    await fs.mkdir(repoDir, { recursive: true });

    const result = await clearCachedRepo('org', 'repo');
    assert.equal(result.ok, true);

    await assert.rejects(fs.access(repoDir));
  });

  void it('does delete all cache dirs', async () => {
    const cacheDir = path.join(tempHome, '.envlt', 'cache');
    await fs.mkdir(path.join(cacheDir, 'a__b'), { recursive: true });

    const result = await clearAllCache();
    assert.equal(result.ok, true);

    await assert.rejects(fs.access(cacheDir));
  });
});
