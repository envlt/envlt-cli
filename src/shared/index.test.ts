import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { encrypt } from '../crypto.js';
import { AppError, ErrorCode } from '../errors.js';
import type { EnvVars } from '../envfile.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter, type StorageAdapter } from '../storage/index.js';

import { resolveExtends } from './index.js';

const KEY = 'f'.repeat(64);

type EnsureRepoFn = (org: string, repo: string, cacheDir?: string) => Promise<Result<string>>;

let cacheRoot = '';
let adapter: StorageAdapter;

function makeEnsureRepo(baseDir: string): EnsureRepoFn {
  return (org: string, repo: string): Promise<Result<string>> =>
    Promise.resolve(ok(path.join(baseDir, `${org}__${repo}`)));
}

async function writeShared(
  org: string,
  repo: string,
  entryPath: string,
  vars: EnvVars,
  keyHex: string = KEY,
): Promise<void> {
  const repoDir = path.join(cacheRoot, `${org}__${repo}`);
  const filePath = path.join(repoDir, `${entryPath}.enc`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const text = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  await fs.writeFile(filePath, encrypt(`${text}\n`, keyHex), 'utf8');
}

beforeEach(async () => {
  cacheRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(cacheRoot, { recursive: true });
  adapter = createFilesystemAdapter('/');
});

afterEach(async () => {
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

void describe('shared/index', () => {
  void it('does return vars for single extends entry', async () => {
    await writeShared('org', 'repo', 'shared/base', { API_URL: 'https://x' });

    const result = await resolveExtends(
      ['github:org/repo/shared/base'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );

    if (!result.ok) {
      assert.fail(result.error.message);
    }

    assert.equal(result.value['API_URL'], 'https://x');
  });

  void it('does merge multiple entries with later values overriding', async () => {
    await writeShared('org', 'repo', 'a', { A: '1', B: '2' });
    await writeShared('org', 'repo', 'b', { B: '9', C: '3' });

    const result = await resolveExtends(
      ['github:org/repo/a', 'github:org/repo/b'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );
    if (!result.ok) {
      assert.fail(result.error.message);
    }

    assert.deepEqual(result.value, { A: '1', B: '9', C: '3' });
  });

  void it('does keep local vars winning when caller merges', async () => {
    await writeShared('org', 'repo', 'x', { TOKEN: 'shared' });
    const sharedResult = await resolveExtends(
      ['github:org/repo/x'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );
    if (!sharedResult.ok) {
      assert.fail(sharedResult.error.message);
    }

    const merged = { ...sharedResult.value, TOKEN: 'local' };
    assert.equal(merged.TOKEN, 'local');
  });

  void it('does return CONFIG_INVALID for invalid extends entry', async () => {
    const result = await resolveExtends(
      ['s3:bucket/path'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );

    if (result.ok) {
      assert.fail('Expected parse failure');
    }

    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });

  void it('does return ENVFILE_PARSE_ERROR when shared entry contents are not .env format', async () => {
    const repoDir = path.join(cacheRoot, 'org__repo');
    const filePath = path.join(repoDir, 'broken.enc');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, encrypt('not-an-assignment', KEY), 'utf8');

    const result = await resolveExtends(
      ['github:org/repo/broken'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );

    if (result.ok) {
      assert.fail('Expected parse error');
    }

    assert.equal(result.error.code, ErrorCode.ENVFILE_PARSE_ERROR);
  });

  void it('does return SHARED_ENTRY_NOT_FOUND when enc file does not exist', async () => {
    const result = await resolveExtends(
      ['github:org/repo/missing'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );

    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.SHARED_ENTRY_NOT_FOUND);
  });

  void it('does return ensure repo error when cache resolution fails', async () => {
    const result = await resolveExtends(
      ['github:org/repo/x'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      (): Promise<Result<string>> =>
        Promise.resolve(err(new AppError(ErrorCode.SHARED_GIT_ERROR, 'git fail'))),
    );

    if (result.ok) {
      assert.fail('Expected ensure repo error');
    }

    assert.equal(result.error.code, ErrorCode.SHARED_GIT_ERROR);
  });

  void it('does return CRYPTO_DECRYPT_FAILED when key is wrong', async () => {
    await writeShared('org', 'repo', 'x', { X: '1' }, 'a'.repeat(64));
    const result = await resolveExtends(
      ['github:org/repo/x'],
      'test',
      KEY,
      adapter,
      cacheRoot,
      makeEnsureRepo(cacheRoot),
    );
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.CRYPTO_DECRYPT_FAILED);
  });
});
