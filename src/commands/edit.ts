import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { readConfig } from '../config.js';
import {
  encEnvFileName,
  parseEnv,
  readEncEnv,
  stringifyEnv,
  writeEncEnv,
  type EnvVars,
} from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { loadKey } from '../keystore.js';
import { logger } from '../logger.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter, type StorageAdapter } from '../storage/index.js';

export type EditOptions = {
  readonly env: string;
  readonly projectRoot: string;
  readonly keyId?: string;
  readonly editor?: string;
};

type EditDeps = {
  readonly createAdapter: (projectRoot: string) => StorageAdapter;
  readonly writeFile: typeof fs.writeFile;
  readonly chmod: typeof fs.chmod;
  readonly readFile: typeof fs.readFile;
  readonly unlink: typeof fs.unlink;
  readonly runEditor: typeof spawnSync;
};

const TEMP_FILE_PREFIX = 'envlt-edit-';
const TEMP_FILE_EXTENSION = '.env';
const TEMP_FILE_MODE = 0o600;
const EDIT_ABORTED_MESSAGE = 'Edit aborted, no changes saved';
const ENV_SAVED_MESSAGE = '✓ Environment saved';
const TEMP_DELETE_WARNING = 'Warning: failed to remove temporary edit file';

const DEFAULT_DEPS: EditDeps = {
  createAdapter: createFilesystemAdapter,
  writeFile: fs.writeFile,
  chmod: fs.chmod,
  readFile: fs.readFile,
  unlink: fs.unlink,
  runEditor: spawnSync,
};

function resolveEditorCommand(options: EditOptions): string {
  return options.editor ?? process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'vi';
}

function splitEditorCommand(command: string): Result<readonly [string, ...string[]]> {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | undefined;

  for (const char of command) {
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single';
      continue;
    }

    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double';
      continue;
    }

    if (char === ' ' && quote === undefined) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote !== undefined) {
    return err(new AppError(ErrorCode.EDIT_INVALID_EDITOR_COMMAND, 'Invalid editor command.'));
  }

  if (current !== '') {
    tokens.push(current);
  }

  const executable = tokens[0];
  if (executable === undefined) {
    return err(new AppError(ErrorCode.EDIT_INVALID_EDITOR_COMMAND, 'Invalid editor command.'));
  }

  return ok([executable, ...tokens.slice(1)]);
}

function isEditorNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  const { code } = error;
  return typeof code === 'string' && code === 'ENOENT';
}

function resolveEnvPath(options: EditOptions): Result<string> {
  try {
    return ok(path.resolve(options.projectRoot, encEnvFileName(options.env)));
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(
      new AppError(ErrorCode.ENVFILE_INVALID_ENV_NAME, 'Invalid environment name.', error),
    );
  }
}

async function readExistingVars(
  options: EditOptions,
  keyHex: string,
  deps: EditDeps,
): Promise<Result<EnvVars>> {
  const adapter = deps.createAdapter(options.projectRoot);
  const envPathResult = resolveEnvPath(options);
  if (!envPathResult.ok) {
    return err(envPathResult.error);
  }

  const existsResult = await adapter.exists(envPathResult.value);
  if (!existsResult.ok) {
    return err(existsResult.error);
  }

  if (!existsResult.value) {
    return ok({});
  }

  return readEncEnv(options.env, keyHex, options.projectRoot, adapter);
}

async function writeTempFile(
  filePath: string,
  content: string,
  deps: EditDeps,
): Promise<Result<void>> {
  try {
    await deps.writeFile(filePath, content, { mode: TEMP_FILE_MODE, flag: 'wx' });
    await deps.chmod(filePath, TEMP_FILE_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    try {
      await deps.unlink(filePath);
    } catch {
      // Best-effort cleanup.
    }

    return err(
      new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to create temporary edit file.', error),
    );
  }
}

function openEditor(editor: string, filePath: string, deps: EditDeps): Result<boolean> {
  const commandResult = splitEditorCommand(editor);
  if (!commandResult.ok) {
    return err(commandResult.error);
  }

  const [executable, ...args] = commandResult.value;
  const result: SpawnSyncReturns<Buffer> = deps.runEditor(executable, [...args, filePath], {
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    if (isEditorNotFoundError(result.error)) {
      return err(
        new AppError(
          ErrorCode.EDIT_EDITOR_NOT_FOUND,
          'Editor command was not found.',
          result.error,
        ),
      );
    }

    return err(
      new AppError(
        ErrorCode.EDIT_EDITOR_EXEC_FAILED,
        'Failed to run editor command.',
        result.error,
      ),
    );
  }

  return ok(result.status === 0);
}

export async function runEdit(
  options: EditOptions,
  deps: EditDeps = DEFAULT_DEPS,
): Promise<Result<void>> {
  const adapter = deps.createAdapter(options.projectRoot);
  const configResult = await readConfig(options.projectRoot, adapter);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const keyId = options.keyId ?? configResult.value.keyId;
  const keyResult = await loadKey(keyId);
  if (!keyResult.ok) {
    return err(keyResult.error);
  }

  const varsResult = await readExistingVars(options, keyResult.value, deps);
  if (!varsResult.ok) {
    return err(varsResult.error);
  }

  const tempPath = path.join(
    os.tmpdir(),
    `${TEMP_FILE_PREFIX}${randomUUID()}${TEMP_FILE_EXTENSION}`,
  );
  const writeResult = await writeTempFile(tempPath, stringifyEnv(varsResult.value), deps);
  if (!writeResult.ok) {
    return err(writeResult.error);
  }

  try {
    const editorResult = openEditor(resolveEditorCommand(options), tempPath, deps);
    if (!editorResult.ok) {
      return err(editorResult.error);
    }

    if (!editorResult.value) {
      logger.info(EDIT_ABORTED_MESSAGE);
      return ok(undefined);
    }

    const content = await deps.readFile(tempPath, 'utf8');
    const parsed = parseEnv(content);
    if (!parsed.ok) {
      logger.error(parsed.error.message);
      return err(parsed.error);
    }

    const saveResult = await writeEncEnv(
      options.env,
      parsed.value,
      keyResult.value,
      options.projectRoot,
      adapter,
    );
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    logger.success(ENV_SAVED_MESSAGE);
    return ok(undefined);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(
      new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read edited temporary file.', error),
    );
  } finally {
    try {
      await deps.unlink(tempPath);
    } catch {
      logger.warn(TEMP_DELETE_WARNING);
    }
  }
}
