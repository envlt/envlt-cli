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

  void it('does uninstall envlt-managed hook', async () => {
    await installPreCommitHook({ projectRoot });

    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, true);

    await assert.rejects(fs.access(hookPath(projectRoot)));
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
    const original = '#!/bin/sh\necho custom-original\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    await installPreCommitHook({ projectRoot, force: true });
    const uninstallResult = await uninstallPreCommitHook(projectRoot);
    assert.equal(uninstallResult.ok, true);

    const restored = await fs.readFile(fullPath, 'utf8');
    assert.equal(restored, original);
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
    const original = '#!/bin/sh\necho custom-hook\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    const result = expectOk(await installPreCommitHook({ projectRoot, force: true }));

    assert.deepEqual(result, { status: 'updated' });
    const content = await fs.readFile(fullPath, 'utf8');
    assert.ok(content.includes(PREPENDED_MARKER));
    assert.match(content, new RegExp(HOOK_CMD, 'u'));
    assert.match(content, new RegExp(ORIGINAL_HOOK_MARKER, 'u'));
    assert.match(content, /echo custom-hook/u);
  });

  void it('does preserve original hook when force is run on prepended hook repeatedly', async () => {
    const fullPath = hookPath(projectRoot);
    const original = '#!/bin/sh\necho original-still-here\n';
    await fs.writeFile(fullPath, original, { mode: 0o755 });

    await installPreCommitHook({ projectRoot, force: true });
    const second = expectOk(await installPreCommitHook({ projectRoot, force: true }));
    assert.deepEqual(second, { status: 'updated' });

    const content = await fs.readFile(fullPath, 'utf8');
    assert.match(content, /echo original-still-here/u);
    assert.equal(content.split(ORIGINAL_HOOK_MARKER).length - 1, 1);
    assert.equal(content.split(PREPENDED_MARKER).length - 1, 1);
  });
});
