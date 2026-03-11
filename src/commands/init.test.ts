import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { readConfig } from '../config.js';
import { AppError, ErrorCode } from '../errors.js';
import { readEncEnv, writeEncEnv } from '../envfile.js';
import { loadKey } from '../keystore.js';
import { type Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';

import { runInit, type Prompter } from './init.js';

type PromptCall =
  | { readonly kind: 'confirm'; readonly value: boolean }
  | { readonly kind: 'input'; readonly value: string }
  | { readonly kind: 'checkbox'; readonly value: readonly string[] };

function dequeueByKind(queue: PromptCall[], expectedKind: PromptCall['kind']): PromptCall {
  const next = queue.shift();
  if (next === undefined) {
    throw new Error('Missing prompt answer.');
  }

  assert.equal(next.kind, expectedKind);
  return next;
}

class FakePrompter implements Prompter {
  private readonly queue: PromptCall[];
  public confirmCount = 0;

  public constructor(calls: readonly PromptCall[]) {
    this.queue = [...calls];
  }

  public confirm(message: string, defaultValue?: boolean): Promise<boolean> {
    void message;
    void defaultValue;
    this.confirmCount += 1;
    const next = dequeueByKind(this.queue, 'confirm');
    if (next.kind !== 'confirm') {
      throw new Error('Unexpected prompt kind.');
    }

    return Promise.resolve(next.value);
  }

  public input(
    message: string,
    defaultValue?: string,
    validate?: (value: string) => string | true,
  ): Promise<string> {
    void message;
    void defaultValue;
    void validate;
    const next = dequeueByKind(this.queue, 'input');
    if (next.kind !== 'input') {
      throw new Error('Unexpected prompt kind.');
    }

    return Promise.resolve(next.value);
  }

  public checkbox(message: string, choices: readonly string[]): Promise<readonly string[]> {
    void message;
    void choices;
    const next = dequeueByKind(this.queue, 'checkbox');
    if (next.kind !== 'checkbox') {
      throw new Error('Unexpected prompt kind.');
    }

    return Promise.resolve(next.value);
  }
}

let projectRoot = '';
let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];

  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });

  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
});

afterEach(async () => {
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

  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

function withDeps(
  prompter: Prompter,
  writes: string[],
): {
  readonly prompter: Prompter;
  readonly createAdapter: typeof createFilesystemAdapter;
  readonly keyGenerator: () => string;
  readonly now: () => number;
  readonly saveGeneratedKey: (keyId: string, key: string) => Promise<Result<void>>;
  readonly writeStdout: (message: string) => void;
} {
  return {
    prompter,
    createAdapter: createFilesystemAdapter,
    keyGenerator: (): string => 'f'.repeat(64),
    now: (): number => 12345678,
    saveGeneratedKey: (keyId: string, key: string): Promise<Result<void>> =>
      import('../keystore.js').then(({ saveKey }) => saveKey(keyId, key, projectRoot)),
    writeStdout: (message: string): void => {
      writes.push(message);
    },
  };
}

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

void describe('commands/init', () => {
  void it('does create config, env files, and key', async () => {
    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development', 'staging'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const adapter = createFilesystemAdapter(projectRoot);
    const configValue = expectOk(await readConfig(projectRoot, adapter));
    assert.equal(configValue.appName, 'myapp');
    assert.deepEqual(configValue.envs, ['development', 'staging']);
    assert.equal(configValue.keyId, 'myapp-12345678');

    const keyResult = await loadKey('myapp-12345678', projectRoot);
    assert.equal(keyResult.ok, true);

    const envResult = expectOk(
      await readEncEnv('development', 'f'.repeat(64), projectRoot, adapter),
    );
    assert.deepEqual(envResult, {});

    assert.equal(writes.length, 1);
    assert.match(writes.at(0) ?? '', /ENVLT_KEY=/u);
  });

  void it('does generate keyId within 64 characters for long app names', async () => {
    const longName = 'a'.repeat(64);
    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: longName },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const configValue = expectOk(
      await readConfig(projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.equal(configValue.keyId.length, 64);
    assert.match(configValue.keyId, /^[a-z0-9_-]+-\d{8}$/u);
  });

  void it('does import .env.local values when enabled', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.env.local'),
      'API_URL=https://x\nTOKEN=abc\n',
      'utf8',
    );

    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development', 'production'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: true },
      { kind: 'checkbox', value: ['API_URL'] },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const adapter = createFilesystemAdapter(projectRoot);
    const dev = expectOk(await readEncEnv('development', 'f'.repeat(64), projectRoot, adapter));
    const prod = expectOk(await readEncEnv('production', 'f'.repeat(64), projectRoot, adapter));
    assert.deepEqual(dev, { API_URL: 'https://x' });
    assert.deepEqual(prod, {});
  });

  void it('does skip import when user declines', async () => {
    await fs.writeFile(path.join(projectRoot, '.env.local'), 'TOKEN=abc\n', 'utf8');

    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const adapter = createFilesystemAdapter(projectRoot);
    const dev = expectOk(await readEncEnv('development', 'f'.repeat(64), projectRoot, adapter));
    assert.deepEqual(dev, {});
  });

  void it('does prompt before overwrite when config exists and force is false', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      '{"appName":"a","envs":["development"],"keyId":"a"}\n',
    );

    const writes: string[] = [];
    const prompter = new FakePrompter([{ kind: 'confirm', value: false }]);
    const result = await runInit({ projectRoot }, withDeps(prompter, writes));

    assert.equal(result.ok, true);
    assert.equal(prompter.confirmCount, 1);
    assert.equal(writes.length, 0);
  });

  void it('does overwrite without prompt when force is true', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      '{"appName":"a","envs":["development"],"keyId":"a"}\n',
    );

    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit(
      { projectRoot, force: true, skipImport: true },
      withDeps(prompter, writes),
    );
    assert.equal(result.ok, true);
    assert.equal(prompter.confirmCount, 1);
  });

  void it('does reuse existing key when encrypted env files already exist', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const originalKey = 'a'.repeat(64);
    const saveOriginal = await import('../keystore.js').then(({ saveKey }) =>
      saveKey('existing-key', originalKey, projectRoot),
    );
    assert.equal(saveOriginal.ok, true);

    const writeExisting = await writeEncEnv(
      'development',
      { KEEP: 'yes' },
      originalKey,
      projectRoot,
      adapter,
    );
    assert.equal(writeExisting.ok, true);

    const existingConfig = {
      appName: 'oldapp',
      envs: ['development'],
      keyId: 'existing-key',
    };
    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      `${JSON.stringify(existingConfig)}
`,
      'utf8',
    );

    let savedCount = 0;
    const prompter = new FakePrompter([
      { kind: 'input', value: 'newapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const deps = {
      ...withDeps(prompter, []),
      saveGeneratedKey: (keyId: string, key: string): Promise<Result<void>> => {
        void keyId;
        void key;
        savedCount += 1;
        return Promise.resolve({ ok: true, value: undefined });
      },
    };

    const result = await runInit({ projectRoot, force: true, skipImport: true }, deps);
    assert.equal(result.ok, true);
    assert.equal(savedCount, 0);

    const configValue = expectOk(await readConfig(projectRoot, adapter));
    assert.equal(configValue.keyId, 'existing-key');

    const decrypted = expectOk(await readEncEnv('development', originalKey, projectRoot, adapter));
    assert.deepEqual(decrypted, { KEEP: 'yes' });
  });

  void it('does not overwrite existing encrypted env files', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const existingKey = 'a'.repeat(64);
    const saveOriginal = await import('../keystore.js').then(({ saveKey }) =>
      saveKey('existing-key', existingKey, projectRoot),
    );
    assert.equal(saveOriginal.ok, true);

    const writeExisting = await writeEncEnv(
      'development',
      { KEEP: 'yes' },
      existingKey,
      projectRoot,
      adapter,
    );
    assert.equal(writeExisting.ok, true);

    await fs.writeFile(
      path.join(projectRoot, 'envlt.config.json'),
      `${JSON.stringify({ appName: 'oldapp', envs: ['development'], keyId: 'existing-key' })}
`,
      'utf8',
    );

    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'confirm', value: true },
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const existing = expectOk(await readEncEnv('development', existingKey, projectRoot, adapter));
    assert.deepEqual(existing, { KEEP: 'yes' });
  });

  void it('does create gitignore without a leading blank line when file is missing', async () => {
    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const gitignore = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8');
    assert.equal(gitignore.startsWith('\n'), false);
    assert.match(gitignore, /^# envlt\n/u);
  });

  void it('does append gitignore additions without duplication', async () => {
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '# existing\n.env.local\n', 'utf8');

    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const first = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(first.ok, true);

    const secondPrompter = new FakePrompter([
      { kind: 'confirm', value: true },
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);
    const second = await runInit(
      { projectRoot, skipImport: true },
      withDeps(secondPrompter, writes),
    );
    assert.equal(second.ok, true);

    const gitignore = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8');
    assert.equal(gitignore.match(/# envlt/gu)?.length ?? 0, 1);
    assert.equal(gitignore.match(/\.env\.local/gu)?.length ?? 0, 1);
    assert.equal(gitignore.match(/\*\.enc\.env\.tmp/gu)?.length ?? 0, 1);
  });

  void it('does generate a new key id when candidate already exists', async () => {
    const saveExisting = await import('../keystore.js').then(({ saveKey }) =>
      saveKey('myapp-12345678', '0'.repeat(64), projectRoot),
    );
    assert.equal(saveExisting.ok, true);

    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(result.ok, true);

    const configResult = expectOk(
      await readConfig(projectRoot, createFilesystemAdapter(projectRoot)),
    );
    assert.equal(configResult.keyId, 'myapp-12345679');
  });

  void it('does fail when no environment is selected', async () => {
    const writes: string[] = [];
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: [] },
      { kind: 'input', value: '' },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, writes));
    assert.equal(result.ok, false);
  });
});

void describe('commands/init error branches', () => {
  void it('does return parse error when .env.local is malformed', async () => {
    await fs.writeFile(path.join(projectRoot, '.env.local'), 'BROKEN_LINE\n', 'utf8');
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: true },
    ]);

    const result = await runInit({ projectRoot }, withDeps(prompter, []));
    assert.equal(result.ok, false);
  });

  void it('does skip invalid custom env then continue', async () => {
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: 'INVALID' },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, []));
    assert.equal(result.ok, true);
  });

  void it('does call workflow generator branch when confirmed', async () => {
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: true },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, []));
    assert.equal(result.ok, true);
  });

  void it('does return write error when config write fails', async () => {
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const deps = withDeps(prompter, []);
    const base = createFilesystemAdapter(projectRoot);
    const failingAdapter = {
      read: base.read,
      exists: base.exists,
      delete: base.delete,
      write: async (inputPath: string, data: Buffer): Promise<Result<void>> => {
        if (inputPath.endsWith('envlt.config.json')) {
          return {
            ok: false,
            error: new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'fail config write'),
          };
        }

        return base.write(inputPath, data);
      },
    };

    const result = await runInit(
      { projectRoot, skipImport: true },
      { ...deps, createAdapter: () => failingAdapter },
    );
    assert.equal(result.ok, false);
  });
});

void describe('commands/init additional coverage', () => {
  void it('does return error when env file existence check fails', async () => {
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);
    const deps = withDeps(prompter, []);
    const base = createFilesystemAdapter(projectRoot);

    const adapter = {
      read: base.read,
      delete: base.delete,
      write: base.write,
      exists: async (inputPath: string): Promise<Result<boolean>> => {
        if (inputPath.endsWith('.env.development.enc')) {
          return { ok: false, error: new AppError(ErrorCode.STORAGE_READ_ERROR, 'exists failed') };
        }

        return base.exists(inputPath);
      },
    };

    const result = await runInit(
      { projectRoot, skipImport: true },
      { ...deps, createAdapter: () => adapter },
    );
    assert.equal(result.ok, false);
  });

  void it('does return error when selected env name is invalid for writing', async () => {
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['INVALID_ENV'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const result = await runInit({ projectRoot, skipImport: true }, withDeps(prompter, []));
    assert.equal(result.ok, false);
  });

  void it('does return error when gitignore write fails', async () => {
    const prompter = new FakePrompter([
      { kind: 'input', value: 'myapp' },
      { kind: 'checkbox', value: ['development'] },
      { kind: 'input', value: '' },
      { kind: 'confirm', value: false },
    ]);

    const deps = withDeps(prompter, []);
    const base = createFilesystemAdapter(projectRoot);
    const adapter = {
      read: base.read,
      delete: base.delete,
      exists: base.exists,
      write: async (inputPath: string, data: Buffer): Promise<Result<void>> => {
        if (inputPath.endsWith('.gitignore')) {
          return { ok: false, error: new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'cannot write') };
        }

        return base.write(inputPath, data);
      },
    };

    const result = await runInit(
      { projectRoot, skipImport: true },
      { ...deps, createAdapter: () => adapter },
    );
    assert.equal(result.ok, false);
  });
});
