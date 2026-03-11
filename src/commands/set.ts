import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { readConfig } from '../config.js';
import { encrypt } from '../crypto.js';
import { encEnvFileName, readEncEnv, stringifyEnv, type EnvVars } from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { loadKey } from '../keystore.js';
import { logger } from '../logger.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';
import { parseAssignment } from '../validation/keys.js';

export type SetOptions = {
  readonly env: string;
  readonly projectRoot: string;
  readonly keyId?: string;
};

type FileOps = {
  readonly writeFile: typeof fs.writeFile;
  readonly rename: typeof fs.rename;
  readonly rm: typeof fs.rm;
};

const TEMP_FILE_SUFFIX = '.tmp';
const ENCRYPTED_ENV_FILE_MODE = 0o600;
const DEFAULT_FILE_OPS: FileOps = {
  writeFile: fs.writeFile,
  rename: fs.rename,
  rm: fs.rm,
};

async function readExistingVars(
  envName: string,
  keyHex: string,
  projectRoot: string,
): Promise<Result<EnvVars>> {
  try {
    const adapter = createFilesystemAdapter(projectRoot);
    const envPath = path.resolve(projectRoot, encEnvFileName(envName));
    const existsResult = await adapter.exists(envPath);
    if (!existsResult.ok) {
      return err(existsResult.error);
    }

    if (!existsResult.value) {
      return ok({});
    }

    return await readEncEnv(envName, keyHex, projectRoot, adapter);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read env file.', error));
  }
}

async function writeEncEnvAtomically(
  envName: string,
  vars: EnvVars,
  keyHex: string,
  projectRoot: string,
  fileOps: FileOps = DEFAULT_FILE_OPS,
): Promise<Result<void>> {
  let filePath: string;
  try {
    filePath = path.resolve(projectRoot, encEnvFileName(envName));
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write env file.', error));
  }

  const tmpPath = `${filePath}${TEMP_FILE_SUFFIX}`;

  try {
    await fileOps.writeFile(tmpPath, encrypt(stringifyEnv(vars), keyHex), {
      mode: ENCRYPTED_ENV_FILE_MODE,
    });
    await fileOps.rename(tmpPath, filePath);
    return ok(undefined);
  } catch (error: unknown) {
    return err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write env file.', error));
  } finally {
    try {
      await fileOps.rm(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup: do not override the result of write/rename.
    }
  }
}

export async function runSet(
  assignments: readonly string[],
  options: SetOptions,
  fileOps: FileOps = DEFAULT_FILE_OPS,
): Promise<Result<void>> {
  const adapter = createFilesystemAdapter(options.projectRoot);
  const configResult = await readConfig(options.projectRoot, adapter);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const keyId = options.keyId ?? configResult.value.keyId;
  const keyResult = await loadKey(keyId, options.projectRoot);
  if (!keyResult.ok) {
    return err(keyResult.error);
  }

  const existingVars = await readExistingVars(options.env, keyResult.value, options.projectRoot);
  if (!existingVars.ok) {
    return err(existingVars.error);
  }

  const mergedVars: Record<string, string> = { ...existingVars.value };
  for (const assignment of assignments) {
    const parsed = parseAssignment(assignment, configResult.value.customDictionary);
    if (!parsed.ok) {
      return err(parsed.error);
    }

    for (const warning of parsed.value.warnings) {
      logger.warn(warning);
    }

    mergedVars[parsed.value.key] = parsed.value.value;
  }

  return writeEncEnvAtomically(
    options.env,
    mergedVars,
    keyResult.value,
    options.projectRoot,
    fileOps,
  );
}
