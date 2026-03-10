import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Result } from '../result.js';

import { installPreCommitHook, isHookInstalled, uninstallPreCommitHook } from './install.js';

const MARKER = '# envlt:pre-commit';
const PREPENDED_MARKER = '# envlt:pre-commit (prepended)';
const HOOK_CMD = 'npx --no-install envlt check';
const ORIGINAL_HOOK_MARKER = '# Original hook follows:';
const HOOK_PATH_PARTS = ['.git', 'hooks', 'pre-commit'] as const;

function hookPath(projectRoot: string): string {
  return path.join(projectRoot, ...HOOK_PATH_PARTS);
}

let projectRoot = '';

function expectOk<T>(result: Result<T>): T {
  if (result.ok) {
    return result.value;
  }

  throw result.error;
}

beforeEach(async () => {
  projectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

void describe('hooks/install', () => {
  void it('does create the hook with correct content and executable mode', async () => {
    const result = expectOk(await installPreCommitHook({ projectRoot }));

    assert.deepEqual(result, { status: 'installed' });
    const fullPath = hookPath(projectRoot);
    const content = await fs.readFile(fullPath, 'utf8');
    assert.match(content, /^#!\/bin\/sh/u);
    assert.match(content, /set -e/u);
    assert.match(content, /npx --no-install envlt check/u);
    assert.match(content, new RegExp(MARKER, 'u'));

    const stats = await fs.stat(fullPath);
    assert.equal(stats.mode & 0o777, 0o755);
  });

  void it('does support gitdir pointer files', async () => {
    const gitRoot = path.join(projectRoot, 'actual-git-dir');
    await fs.mkdir(path.join(gitRoot, 'hooks'), { recursive: true });
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.writeFile(path.join(projectRoot, '.git'), `gitdir: ${gitRoot}\n`, 'utf8');

    const result = expectOk(await installPreCommitHook({ projectRoot }));
    assert.deepEqual(result, { status: 'installed' });

    const content = await fs.readFile(path.join(gitRoot, 'hooks', 'pre-commit'), 'utf8');
    assert.match(content, /envlt check/u);
  });

  void it('does skip gitdir pointer when target directory does not exist', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.writeFile(path.join(projectRoot, '.git'), 'gitdir: missing-gitdir\n', 'utf8');

    const result = expectOk(await installPreCommitHook({ projectRoot }));
    assert.deepEqual(result, { status: 'skipped', reason: 'not_a_git_repo' });
  });

  void it('does return error when resolving .git metadata hits filesystem errors', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.symlink('.git', path.join(projectRoot, '.git'));

    const result = await installPreCommitHook({ projectRoot });
    assert.equal(result.ok, false);
  });

  void it('does return write error when gitdir target is read-only', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }
    const readonlyGitRoot = path.join(projectRoot, 'readonly-git');
    const readonlyHooks = path.join(readonlyGitRoot, 'hooks');
    await fs.mkdir(readonlyHooks, { recursive: true });
    await fs.chmod(readonlyHooks, 0o500);

    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.writeFile(path.join(projectRoot, '.git'), `gitdir: ${readonlyGitRoot}\n`, 'utf8');

    try {
      const result = await installPreCommitHook({ projectRoot });
      assert.equal(result.ok, false);
    } finally {
      await fs.chmod(readonlyHooks, 0o700);
    }
  });

  void it('does fail when .git pointer file is malformed', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.writeFile(path.join(projectRoot, '.git'), 'invalid-git-pointer\n', 'utf8');

    const result = await installPreCommitHook({ projectRoot });
    assert.equal(result.ok, false);
  });

  void it('does skip when hook already exists and force is false', async () => {
    await installPreCommitHook({ projectRoot });
    const second = expectOk(await installPreCommitHook({ projectRoot }));

    assert.deepEqual(second, { status: 'skipped', reason: 'already_exists' });
  });

  void it('does update existing envlt hook when force is true', async () => {
    const fullPath = hookPath(projectRoot);
    await fs.writeFile(fullPath, '#!/bin/sh\n# envlt:pre-commit\necho old\n', 'utf8');

    const result = expectOk(await installPreCommitHook({ projectRoot, force: true }));

    assert.deepEqual(result, { status: 'updated' });
    const content = await fs.readFile(fullPath, 'utf8');
    assert.match(content, new RegExp(HOOK_CMD, 'u'));
    assert.ok(!content.includes('echo old'));
  });

  void it('does return not_a_git_repo when .git does not exist', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });

    const result = expectOk(await installPreCommitHook({ projectRoot }));

    assert.deepEqual(result, { status: 'skipped', reason: 'not_a_git_repo' });
  });

  void it('does return error when install cannot read existing hook path', async () => {
    await fs.mkdir(hookPath(projectRoot), { recursive: true });

    const result = await installPreCommitHook({ projectRoot, force: true });
    assert.equal(result.ok, false);
  });

  void it('does fail force update when prepended hook is malformed', async () => {
    const fullPath = hookPath(projectRoot);
    await fs.writeFile(fullPath, '#!/bin/sh\n# envlt:pre-commit (prepended)\n', 'utf8');

    const result = await installPreCommitHook({ projectRoot, force: true });
    assert.equal(result.ok, false);
  });

  void it('does report installed status through isHookInstalled', async () => {
    const before = await isHookInstalled(projectRoot);
    assert.equal(before, false);

    await installPreCommitHook({ projectRoot });
    const after = await isHookInstalled(projectRoot);
    assert.equal(after, true);
  });

  void it('does return false for hook status when .git metadata is invalid', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.writeFile(path.join(projectRoot, '.git'), 'broken-pointer\n', 'utf8');

    const installed = await isHookInstalled(projectRoot);
    assert.equal(installed, false);
  });

  void it('does return false for hook status when hook file cannot be read', async () => {
    await fs.mkdir(hookPath(projectRoot), { recursive: true });

    const installed = await isHookInstalled(projectRoot);
    assert.equal(installed, false);
  });

  void it('does uninstall envlt-managed hook', async () => {
    await installPreCommitHook({ projectRoot });

    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, true);

    await assert.rejects(fs.access(hookPath(projectRoot)));
  });

  void it('does return ok on uninstall when project is not a git repo', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });

    const result = await uninstallPreCommitHook(projectRoot);
    assert.equal(result.ok, true);
  });

  void it('does return error on uninstall when .git metadata is invalid', async () => {
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await fs.writeFile(path.join(projectRoot, '.git'), 'broken-pointer\n', 'utf8');

    const result = await uninstallPreCommitHook(projectRoot);
    assert.equal(result.ok, false);
  });

  void it('does return ok when uninstall is called and hook does not exist', async () => {
    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, true);
  });

  void it('does return read error when uninstall cannot read hook path', async () => {
    await fs.mkdir(hookPath(projectRoot), { recursive: true });

    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, false);
  });

  void it('does fail uninstall when prepended hook is malformed', async () => {
    const fullPath = hookPath(projectRoot);
    await fs.writeFile(fullPath, '#!/bin/sh\n# envlt:pre-commit (prepended)\n', 'utf8');

    const result = await uninstallPreCommitHook(projectRoot);
    assert.equal(result.ok, false);
  });

  void it('does restore original hook on uninstall for prepended hooks', async () => {
    const fullPath = hookPath(projectRoot);
    const original = '#!/usr/bin/env bash\necho custom-original\n[[ 1 -eq 1 ]]\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    await installPreCommitHook({ projectRoot, force: true });
    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, true);

    const restored = await fs.readFile(fullPath, 'utf8');
    assert.equal(restored, original);
  });

  void it('does preserve original hook mode when uninstalling prepended hook', async () => {
    const fullPath = hookPath(projectRoot);
    const original = '#!/usr/bin/env bash\necho restricted\n';
    await fs.writeFile(fullPath, original, { mode: 0o700 });

    await installPreCommitHook({ projectRoot, force: true });
    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, true);

    const restoredStat = await fs.stat(fullPath);
    assert.equal(restoredStat.mode & 0o777, 0o700);
  });

  void it('does refuse uninstall when hook has no envlt marker', async () => {
    const fullPath = hookPath(projectRoot);
    await fs.writeFile(fullPath, '#!/bin/sh\necho custom\n', { mode: 0o755 });

    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    if (uninstallResult.ok) {
      assert.fail('Expected uninstall to fail for non-envlt hook.');
    }

    assert.match(uninstallResult.error.message, /Refusing to remove/u);
    const content = await fs.readFile(fullPath, 'utf8');
    assert.match(content, /echo custom/u);
  });

  void it('does prepend envlt check for force update of non-envlt hook', async () => {
    const fullPath = hookPath(projectRoot);
    const original = '#!/usr/bin/env bash\necho custom-hook\n[[ 2 -gt 1 ]]\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    const result = expectOk(await installPreCommitHook({ projectRoot, force: true }));

    assert.deepEqual(result, { status: 'updated' });
    const content = await fs.readFile(fullPath, 'utf8');
    assert.ok(content.includes(PREPENDED_MARKER));
    assert.match(content, /set -e/u);
    assert.match(content, new RegExp(HOOK_CMD, 'u'));
    assert.match(content, /mktemp/u);
    assert.match(content, /trap .*EXIT/u);
    assert.match(content, /base64 -d/u);
    assert.match(content, /base64 -D/u);
    assert.match(content, /__ENVLT_ORIGINAL_HOOK_B64=/u);
    assert.match(content, /exit 0/u);
    assert.match(content, new RegExp(ORIGINAL_HOOK_MARKER, 'u'));
    assert.ok(!content.includes('[[ 2 -gt 1 ]]'));
    assert.ok(!content.includes("<<'ENVLT_ORIGINAL_HOOK'"));
  });

  void it('does preserve original hook only as encoded metadata in prepended hook', async () => {
    const fullPath = hookPath(projectRoot);
    const original = '#!/usr/bin/env bash\n[[ 3 -gt 1 ]]\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    await installPreCommitHook({ projectRoot, force: true });
    const content = await fs.readFile(fullPath, 'utf8');

    assert.match(content, /# Original hook base64:/u);
    assert.ok(!content.includes('[[ 3 -gt 1 ]]'));
  });

  void it('does preserve original hook when force is run on prepended hook repeatedly', async () => {
    const fullPath = hookPath(projectRoot);
    const original = '#!/bin/sh\necho original-still-here\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    await installPreCommitHook({ projectRoot, force: true });
    const second = expectOk(await installPreCommitHook({ projectRoot, force: true }));
    assert.deepEqual(second, { status: 'updated' });

    const content = await fs.readFile(fullPath, 'utf8');
    assert.match(content, /# Original hook base64:/u);
    assert.ok(!content.includes('echo original-still-here'));
    assert.equal(content.split(ORIGINAL_HOOK_MARKER).length - 1, 1);
    assert.equal(content.split(PREPENDED_MARKER).length - 1, 1);
  });
});
