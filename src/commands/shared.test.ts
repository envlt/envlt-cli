import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ErrorCode } from '../errors.js';

import { runSharedClearCache } from './shared.js';

let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(tempHome, { recursive: true });
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
});

afterEach(async () => {
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

void describe('commands/shared', () => {
  void it('does clear specific repo cache', async () => {
    const target = path.join(tempHome, '.envlt', 'cache', 'org__repo');
    await fs.mkdir(target, { recursive: true });

    const result = await runSharedClearCache({ repo: 'org/repo' });
    assert.equal(result.ok, true);
    await assert.rejects(fs.access(target));
  });

  void it('does clear all cache when repo option is absent', async () => {
    const target = path.join(tempHome, '.envlt', 'cache', 'org__repo');
    await fs.mkdir(target, { recursive: true });

    const result = await runSharedClearCache({});
    assert.equal(result.ok, true);
    await assert.rejects(fs.access(path.join(tempHome, '.envlt', 'cache')));
  });

  void it('does reject invalid repo syntax', async () => {
    const result = await runSharedClearCache({ repo: 'org' });
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });
});
