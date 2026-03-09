import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Manifest } from '../manifest.js';
import type { Result } from '../result.js';

import { runDeclare } from './declare.js';

let projectRoot = '';

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    assert.fail(`Expected ok result, received error: ${result.error.message}`);
  }

  return result.value;
}

beforeEach(async () => {
  projectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

void describe('commands/declare', { concurrency: false }, () => {
  void it('does create manifest file when it does not exist', async () => {
    expectOk(
      await runDeclare('DATABASE_URL', {
        description: 'Database URL',
        env: 'staging',
        projectRoot,
      }),
    );

    const text = await fs.readFile(path.join(projectRoot, 'envlt.manifest.json'), 'utf8');
    const manifest = JSON.parse(text) as Manifest;
    assert.equal(manifest.entries.length, 1);
  });

  void it('does add an entry to existing manifest', async () => {
    expectOk(
      await runDeclare('DATABASE_URL', {
        description: 'Database URL',
        projectRoot,
      }),
    );

    expectOk(
      await runDeclare('REDIS_URL', {
        description: 'Redis URL',
        projectRoot,
      }),
    );

    const text = await fs.readFile(path.join(projectRoot, 'envlt.manifest.json'), 'utf8');
    const manifest = JSON.parse(text) as Manifest;
    assert.deepEqual(
      manifest.entries.map((entry) => entry.key),
      ['DATABASE_URL', 'REDIS_URL'],
    );
  });

  void it('does replace same key entry instead of creating duplicates', async () => {
    expectOk(
      await runDeclare('DATABASE_URL', {
        description: 'Old description',
        projectRoot,
      }),
    );

    expectOk(
      await runDeclare('DATABASE_URL', {
        description: 'New description',
        projectRoot,
      }),
    );

    const text = await fs.readFile(path.join(projectRoot, 'envlt.manifest.json'), 'utf8');
    const manifest = JSON.parse(text) as Manifest;
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0]?.description, 'New description');
  });

  void it('does store description required and secret values', async () => {
    expectOk(
      await runDeclare('PUBLIC_PORT', {
        description: 'Port for service',
        required: false,
        secret: false,
        env: 'staging',
        projectRoot,
      }),
    );

    const text = await fs.readFile(path.join(projectRoot, 'envlt.manifest.json'), 'utf8');
    const manifest = JSON.parse(text) as Manifest;
    const entry = manifest.entries[0];
    assert.ok(entry);
    assert.equal(entry.description, 'Port for service');
    assert.equal(entry.required, false);
    assert.equal(entry.secret, false);
    assert.deepEqual(entry.envs, ['staging']);
  });

  void it('does return error when existing manifest is malformed', async () => {
    await fs.writeFile(path.join(projectRoot, 'envlt.manifest.json'), '{oops', 'utf8');

    const result = await runDeclare('DATABASE_URL', {
      description: 'Database URL',
      projectRoot,
    });

    assert.equal(result.ok, false);
  });

  void it('does return error when manifest cannot be written', async () => {
    const invalidRoot = path.join(projectRoot, 'not-a-directory');
    await fs.writeFile(invalidRoot, 'x', 'utf8');

    const result = await runDeclare('DATABASE_URL', {
      description: 'Database URL',
      projectRoot: invalidRoot,
    });

    assert.equal(result.ok, false);
  });

  void it('does return error when key format is invalid', async () => {
    const result = await runDeclare('not-valid', {
      description: 'Invalid key',
      projectRoot,
    });

    assert.equal(result.ok, false);
  });
});
