import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { encrypt } from '../crypto.js';
import { readConfig } from '../config.js';
import { encEnvFileName, readEncEnv, stringifyEnv, type EnvVars } from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { loadKey } from '../keystore.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';
import { validateEnvVarKey } from '../validation/env-key.js';

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

const ASSIGNMENT_SEPARATOR = '=';
const TEMP_FILE_SUFFIX = '.tmp';
const DEFAULT_FILE_OPS: FileOps = {
  writeFile: fs.writeFile,
  rename: fs.rename,
  rm: fs.rm,
};

function parseAssignment(assignment: string): Result<readonly [string, string]> {
  const separatorIndex = assignment.indexOf(ASSIGNMENT_SEPARATOR);
  if (separatorIndex < 0) {
    return err(
      new AppError(
        ErrorCode.SET_INVALID_ASSIGNMENT,
        `Invalid assignment "${assignment}". Expected KEY=VALUE format.`,
      ),
    );
  }

  const key = assignment.slice(0, separatorIndex);
  const value = assignment.slice(separatorIndex + 1);
  return ok([key, value]);
}

async function readExistingVars(
  envName: string,
  keyHex: string,
  projectRoot: string,
): Promise<Result<EnvVars>> {
  const adapter = createFilesystemAdapter(projectRoot);
  const envPath = path.resolve(projectRoot, encEnvFileName(envName));
  const existsResult = await adapter.exists(envPath);
  if (!existsResult.ok) {
    return err(existsResult.error);
  }

  if (!existsResult.value) {
    return ok({});
  }

  return readEncEnv(envName, keyHex, projectRoot, adapter);
}

async function writeEncEnvAtomically(
  envName: string,
  vars: EnvVars,
  keyHex: string,
  projectRoot: string,
  fileOps: FileOps = DEFAULT_FILE_OPS,
): Promise<Result<void>> {
  const filePath = path.resolve(projectRoot, encEnvFileName(envName));
  const tmpPath = `${filePath}${TEMP_FILE_SUFFIX}`;

  try {
    await fileOps.writeFile(tmpPath, encrypt(stringifyEnv(vars), keyHex), { mode: 0o600 });
    await fileOps.rename(tmpPath, filePath);
    return ok(undefined);
  } catch (error: unknown) {
    return err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write env file.', error));
  } finally {
    await fileOps.rm(tmpPath, { force: true });
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
  const keyResult = await loadKey(keyId);
  if (!keyResult.ok) {
    return err(keyResult.error);
  }

  const existingVars = await readExistingVars(options.env, keyResult.value, options.projectRoot);
  if (!existingVars.ok) {
    return err(existingVars.error);
  }

  const mergedVars: Record<string, string> = { ...existingVars.value };
  for (const assignment of assignments) {
    const parsed = parseAssignment(assignment);
    if (!parsed.ok) {
      return err(parsed.error);
    }

    const [key, value] = parsed.value;
    const keyValidation = validateEnvVarKey(key);
    if (!keyValidation.ok) {
      return err(keyValidation.error);
    }

    mergedVars[key] = value;
  }

  return writeEncEnvAtomically(
    options.env,
    mergedVars,
    keyResult.value,
    options.projectRoot,
    fileOps,
  );
}
