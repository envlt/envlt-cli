import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AppError, ErrorCode } from './errors.js';
import { err, type Result } from './result.js';
import { createFilesystemAdapter } from './storage/index.js';

import {
  readManifest,
  upsertEntry,
  validateManifest,
  writeManifest,
  type Manifest,
  type ManifestEntry,
} from './manifest.js';

let projectRoot = '';

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
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

void describe('manifest', () => {
  void it('does return empty manifest when file is missing', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const manifest = expectOk(await readManifest(projectRoot, adapter));

    assert.deepEqual(manifest, { version: 1, entries: [] });
  });

  void it('does return CONFIG_INVALID when manifest JSON is malformed', async () => {
    await fs.writeFile(path.join(projectRoot, 'envlt.manifest.json'), '{broken json', 'utf8');

    const result = await readManifest(projectRoot, createFilesystemAdapter(projectRoot));
    if (result.ok) {
      assert.fail('Expected malformed manifest error.');
    }

    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID when manifest JSON root is not an object', async () => {
    await fs.writeFile(path.join(projectRoot, 'envlt.manifest.json'), '[]', 'utf8');

    const result = await readManifest(projectRoot, createFilesystemAdapter(projectRoot));
    if (result.ok) {
      assert.fail('Expected invalid manifest result.');
    }
    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID when manifest entries contain invalid shape', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'envlt.manifest.json'),
      JSON.stringify({ version: 1, entries: [123] }),
      'utf8',
    );

    const result = await readManifest(projectRoot, createFilesystemAdapter(projectRoot));
    if (result.ok) {
      assert.fail('Expected invalid manifest result.');
    }
    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });

  void it('does return storage error when adapter exists check fails', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'not used'))),
      write: (): Promise<Result<void>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'not used'))),
      exists: (): Promise<Result<boolean>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'exists failed'))),
      delete: (): Promise<Result<void>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'not used'))),
    };

    const result = await readManifest(projectRoot, adapter);
    assert.equal(result.ok, false);
  });

  void it('does return storage read error when adapter read fails', async () => {
    await fs.writeFile(path.join(projectRoot, 'envlt.manifest.json'), '{}', 'utf8');

    const adapter = {
      read: (): Promise<Result<Buffer>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'read failed'))),
      write: (): Promise<Result<void>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'not used'))),
      exists: (): Promise<Result<boolean>> => Promise.resolve({ ok: true, value: true }),
      delete: (): Promise<Result<void>> =>
        Promise.resolve(err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'not used'))),
    };

    const result = await readManifest(projectRoot, adapter);
    assert.equal(result.ok, false);
  });

  void it('does return STORAGE_WRITE_ERROR when writeManifest cannot write file', async () => {
    const missingRoot = path.join(os.tmpdir(), randomUUID());
    const result = await writeManifest(
      { version: 1, entries: [] },
      missingRoot,
      createFilesystemAdapter(missingRoot),
    );

    if (result.ok) {
      assert.fail('Expected write failure result.');
    }
    assert.equal(result.error.code, ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does round-trip writeManifest then readManifest', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const manifest: Manifest = {
      version: 1,
      entries: [
        { key: 'B', description: 'second', required: true, secret: true },
        { key: 'A', description: 'first', required: false, secret: false },
      ],
    };

    expectOk(await writeManifest(manifest, projectRoot, adapter));
    const loaded = expectOk(await readManifest(projectRoot, adapter));

    assert.deepEqual(
      loaded.entries.map((entry) => entry.key),
      ['A', 'B'],
    );
  });

  void it('does write manifest entries sorted alphabetically', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    expectOk(
      await writeManifest(
        {
          version: 1,
          entries: [
            { key: 'ZZZ', description: 'z', required: true, secret: true },
            { key: 'AAA', description: 'a', required: true, secret: true },
          ],
        },
        projectRoot,
        adapter,
      ),
    );

    const text = await fs.readFile(path.join(projectRoot, 'envlt.manifest.json'), 'utf8');
    assert.ok(text.indexOf('"AAA"') < text.indexOf('"ZZZ"'));
  });

  void it('does add a new entry with upsertEntry when key is new', () => {
    const manifest: Manifest = { version: 1, entries: [] };
    const entry: ManifestEntry = {
      key: 'DATABASE_URL',
      description: 'Database url',
      required: true,
      secret: true,
    };

    const updated = upsertEntry(manifest, entry);
    assert.equal(updated.entries.length, 1);
    assert.deepEqual(updated.entries[0], entry);
  });

  void it('does update existing entry with same key in upsertEntry', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'Old', required: true, secret: true }],
    };

    const updated = upsertEntry(manifest, {
      key: 'DATABASE_URL',
      description: 'New',
      required: true,
      secret: true,
    });

    assert.equal(updated.entries.length, 1);
    assert.equal(updated.entries[0]?.description, 'New');
  });

  void it('does not mutate original manifest in upsertEntry', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [{ key: 'A', description: 'old', required: true, secret: true }],
    };

    const updated = upsertEntry(manifest, {
      key: 'A',
      description: 'new',
      required: true,
      secret: true,
    });

    assert.equal(manifest.entries[0]?.description, 'old');
    assert.equal(updated.entries[0]?.description, 'new');
  });

  void it('does return empty violations when all required vars are present', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    };

    const violations = validateManifest(manifest, { DATABASE_URL: 'x' }, 'staging');
    assert.deepEqual(violations, []);
  });

  void it('does return missing_required for absent required vars', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [{ key: 'DATABASE_URL', description: 'db', required: true, secret: true }],
    };

    const violations = validateManifest(manifest, {}, 'staging');
    assert.deepEqual(violations, [{ key: 'DATABASE_URL', type: 'missing_required' }]);
  });

  void it('does not return missing violation for required false entries', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [{ key: 'OPTIONAL_KEY', description: 'opt', required: false, secret: true }],
    };

    const violations = validateManifest(manifest, {}, 'staging');
    assert.deepEqual(violations, []);
  });

  void it('does respect env filters during validation', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [
        {
          key: 'PROD_ONLY',
          description: 'prod',
          required: true,
          secret: true,
          envs: ['production'],
        },
      ],
    };

    const violations = validateManifest(manifest, {}, 'staging');
    assert.deepEqual(violations, []);
  });

  void it('does report undeclared keys when strict mode is enabled', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [{ key: 'DECLARED', description: 'ok', required: true, secret: true }],
    };

    const violations = validateManifest(manifest, { DECLARED: '1', EXTRA: '2' }, 'staging', true);
    assert.deepEqual(violations, [{ key: 'EXTRA', type: 'undeclared' }]);
  });
});
