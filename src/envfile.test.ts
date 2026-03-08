import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { generateKey } from './crypto.js';
import { AppError, ErrorCode } from './errors.js';
import {
  encEnvFileName,
  parseEnv,
  readEncEnv,
  stringifyEnv,
  writeEncEnv,
  type EnvVars,
} from './envfile.js';
import { type Result } from './result.js';
import { createFilesystemAdapter } from './storage/index.js';

let projectRoot: string;

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function expectErrCode<T>(result: Result<T>): ErrorCode {
  if (result.ok) {
    throw new Error('Expected error result.');
  }

  if (!(result.error instanceof AppError)) {
    throw new Error('Expected AppError.');
  }

  return result.error.code;
}

beforeEach(async () => {
  projectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

void describe('envfile', () => {
  void it('does parse empty string into empty object', () => {
    assert.deepEqual(expectOk(parseEnv('')), {});
  });

  void it('does ignore comment lines and blank lines when parsing', () => {
    const parsed = parseEnv('# comment\n\nKEY=value\n   # trailing comment line\n');
    assert.deepEqual(expectOk(parsed), { KEY: 'value' });
  });

  void it('does parse KEY=VALUE pairs correctly', () => {
    assert.deepEqual(expectOk(parseEnv('KEY=VALUE')), { KEY: 'VALUE' });
  });

  void it('does preserve equals signs inside values', () => {
    assert.deepEqual(expectOk(parseEnv('KEY=val=with=equals')), { KEY: 'val=with=equals' });
  });

  void it('does parse double-quoted values by stripping quotes', () => {
    assert.deepEqual(expectOk(parseEnv('KEY="hello world"')), { KEY: 'hello world' });
  });

  void it('does parse single-quoted values by stripping quotes', () => {
    assert.deepEqual(expectOk(parseEnv("KEY='hello world'")), { KEY: 'hello world' });
  });

  void it('does return ENVFILE_PARSE_ERROR when line is malformed', () => {
    assert.equal(expectErrCode(parseEnv('MALFORMED_LINE')), ErrorCode.ENVFILE_PARSE_ERROR);
  });

  void it('does return ENVFILE_PARSE_ERROR for empty key', () => {
    assert.equal(expectErrCode(parseEnv('=value')), ErrorCode.ENVFILE_PARSE_ERROR);
  });

  void it('does preserve unmatched quote values as-is', () => {
    assert.deepEqual(expectOk(parseEnv('KEY="unterminated')), { KEY: '"unterminated' });
  });

  void it('does stringify env vars in sorted order with trailing newline', () => {
    const input: EnvVars = { B: '2', A: '1' };
    assert.equal(stringifyEnv(input), 'A=1\nB=2\n');
  });

  void it('does round-trip stringifyEnv through parseEnv', () => {
    const input: EnvVars = { C: 'three', A: 'one', B: 'two' };
    const parsed = parseEnv(stringifyEnv(input));
    assert.deepEqual(expectOk(parsed), { A: 'one', B: 'two', C: 'three' });
  });

  void it('does return canonical encrypted env file name', () => {
    assert.equal(encEnvFileName('staging'), '.env.staging.enc');
  });
  void it('does throw ENVFILE_INVALID_ENV_NAME for invalid env in file name helper', () => {
    assert.throws(
      () => {
        encEnvFileName('INVALID');
      },
      (error: unknown) => {
        if (!(error instanceof AppError)) {
          return false;
        }

        return error.code === ErrorCode.ENVFILE_INVALID_ENV_NAME;
      },
    );
  });

  void it('does round-trip writeEncEnv then readEncEnv', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const key = generateKey();
    const vars: EnvVars = {
      API_URL: 'https://example.com',
      NODE_ENV: 'staging',
    };

    expectOk(await writeEncEnv('staging', vars, key, projectRoot, adapter));
    const readResult = await readEncEnv('staging', key, projectRoot, adapter);
    assert.deepEqual(expectOk(readResult), vars);
  });

  void it('does return an error when reading encrypted env file that does not exist', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const result = await readEncEnv('staging', generateKey(), projectRoot, adapter);
    assert.equal(result.ok, false);
  });

  void it('does return CRYPTO_DECRYPT_FAILED when reading with wrong key', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const correctKey = generateKey();
    const wrongKey = generateKey();

    expectOk(await writeEncEnv('staging', { SECRET: 'value' }, correctKey, projectRoot, adapter));
    const readResult = await readEncEnv('staging', wrongKey, projectRoot, adapter);
    assert.equal(expectErrCode(readResult), ErrorCode.CRYPTO_DECRYPT_FAILED);
  });

  void it('does return ENVFILE_INVALID_ENV_NAME when reading with invalid envName', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const result = await readEncEnv('BAD', generateKey(), projectRoot, adapter);
    assert.equal(expectErrCode(result), ErrorCode.ENVFILE_INVALID_ENV_NAME);
  });

  void it('does return CRYPTO_INVALID_KEY when writing with invalid key', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const result = await writeEncEnv('staging', { KEY: 'value' }, 'bad-key', projectRoot, adapter);
    assert.equal(expectErrCode(result), ErrorCode.CRYPTO_INVALID_KEY);
  });

  void it('does return STORAGE_WRITE_ERROR when adapter write throws non-app error', async () => {
    const adapter = {
      read: (): Promise<Result<Buffer>> => Promise.reject(new Error('not implemented')),
      write: (): Promise<Result<void>> => Promise.reject(new Error('write crashed')),
      exists: (): Promise<Result<boolean>> => Promise.reject(new Error('not implemented')),
      delete: (): Promise<Result<void>> => Promise.reject(new Error('not implemented')),
    };

    const result = await writeEncEnv(
      'staging',
      { KEY: 'value' },
      generateKey(),
      projectRoot,
      adapter,
    );
    assert.equal(expectErrCode(result), ErrorCode.STORAGE_WRITE_ERROR);
  });

  void it('does return ENVFILE_INVALID_ENV_NAME for invalid envName', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const result = await writeEncEnv(
      'STAGING',
      { KEY: 'value' },
      generateKey(),
      projectRoot,
      adapter,
    );
    assert.equal(expectErrCode(result), ErrorCode.ENVFILE_INVALID_ENV_NAME);
  });
});
