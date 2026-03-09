import * as path from 'node:path';

import { ENV_NAME_PATTERN } from './constants.js';
import { decrypt, encrypt } from './crypto.js';
import { AppError, ErrorCode } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { StorageAdapter } from './storage/index.js';

export type EnvVars = Readonly<Record<string, string>>;

type EncEnvFile = {
  readonly filePath: string;
};

function isValidEnvName(envName: string): boolean {
  return ENV_NAME_PATTERN.test(envName);
}

function validateEnvName(envName: string): Result<void> {
  if (isValidEnvName(envName)) {
    return ok(undefined);
  }

  return err(new AppError(ErrorCode.ENVFILE_INVALID_ENV_NAME, 'Invalid environment name.'));
}

function assertValidEnvName(envName: string): void {
  const validationResult = validateEnvName(envName);
  if (!validationResult.ok) {
    throw validationResult.error;
  }
}

function unquoteValue(value: string): string {
  const firstChar = value.at(0);
  const lastChar = value.at(-1);
  const hasMatchingQuotes =
    (firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'");

  if (hasMatchingQuotes && value.length >= 2) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseEnv(text: string): Result<EnvVars> {
  const lines = text.split(/\r?\n/u);
  const vars: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
      return err(new AppError(ErrorCode.ENVFILE_PARSE_ERROR, 'Invalid .env format.'));
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key === '') {
      return err(new AppError(ErrorCode.ENVFILE_PARSE_ERROR, 'Invalid .env format.'));
    }

    const rawValue = line.slice(separatorIndex + 1);
    vars[key] = unquoteValue(rawValue);
  }

  return ok(vars);
}

export function stringifyEnv(vars: EnvVars): string {
  const lines = Object.keys(vars)
    .sort()
    .map((key) => `${key}=${vars[key] ?? ''}`);

  return `${lines.join('\n')}\n`;
}

export function encEnvFileName(envName: string): string {
  assertValidEnvName(envName);
  return `.env.${envName}.enc`;
}

function encEnvFilePath(envName: string, projectRoot: string): EncEnvFile {
  return {
    filePath: path.resolve(projectRoot, encEnvFileName(envName)),
  };
}

export async function readEncEnv(
  envName: string,
  keyHex: string,
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<EnvVars>> {
  const validEnvName = validateEnvName(envName);
  if (!validEnvName.ok) {
    return validEnvName;
  }

  const file = encEnvFilePath(envName, projectRoot);
  let readResult;
  try {
    readResult = await adapter.read(file.filePath);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read env file.', error));
  }
  if (!readResult.ok) {
    return err(readResult.error);
  }

  try {
    const decrypted = decrypt(readResult.value.toString('utf8'), keyHex);
    return parseEnv(decrypted);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(new AppError(ErrorCode.CRYPTO_DECRYPT_FAILED, 'Failed to decrypt env file.', error));
  }
}

export async function writeEncEnv(
  envName: string,
  vars: EnvVars,
  keyHex: string,
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<void>> {
  const validEnvName = validateEnvName(envName);
  if (!validEnvName.ok) {
    return validEnvName;
  }

  const file = encEnvFilePath(envName, projectRoot);

  try {
    const serialized = stringifyEnv(vars);
    const encrypted = encrypt(serialized, keyHex);
    return await adapter.write(file.filePath, Buffer.from(encrypted, 'utf8'));
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write env file.', error));
  }
}
