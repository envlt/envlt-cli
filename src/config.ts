import * as path from 'node:path';

import { AppError, ErrorCode } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { StorageAdapter } from './storage/index.js';

export type EnvltConfig = {
  readonly appName: string;
  readonly envs: readonly string[];
  readonly extends?: readonly string[];
  readonly requiredPairs?: readonly [string, string][];
  readonly customDictionary?: readonly string[];
  readonly keyId: string;
};

const CONFIG_FILE_NAME = 'envlt.config.json';
const APP_NAME_MAX_LENGTH = 64;
const ENV_NAME_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;
const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const EXTENDS_ENTRY_PATTERN = /^github:[^/\s]+\/[^/\s]+\/.+$/u;
const ALLOWED_KEYS = new Set([
  'appName',
  'envs',
  'extends',
  'requiredPairs',
  'customDictionary',
  'keyId',
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function hasOnlyAllowedFields(raw: Record<string, unknown>): boolean {
  return Object.keys(raw).every((key) => ALLOWED_KEYS.has(key));
}

function isValidRequiredPairs(value: unknown): value is readonly [string, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string',
    )
  );
}

function isValidAppName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= APP_NAME_MAX_LENGTH;
}

function isValidEnvName(value: string): boolean {
  return ENV_NAME_PATTERN.test(value);
}

function isValidEnvs(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.length > 0 && value.every((entry) => isValidEnvName(entry));
}

function isValidExtends(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.every((entry) => EXTENDS_ENTRY_PATTERN.test(entry));
}

function isValidKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value);
}

function configInvalidError(cause?: unknown): AppError {
  return new AppError(ErrorCode.CONFIG_INVALID, 'Invalid envlt.config.json file.', cause);
}

export function validateConfig(raw: unknown): Result<EnvltConfig> {
  if (!isObjectRecord(raw)) {
    return err(configInvalidError());
  }

  if (!hasOnlyAllowedFields(raw)) {
    return err(configInvalidError());
  }

  const appName = raw['appName'];
  const envs = raw['envs'];
  const keyId = raw['keyId'];
  const extendsValue = raw['extends'];
  const requiredPairs = raw['requiredPairs'];
  const customDictionary = raw['customDictionary'];

  if (!isValidAppName(appName) || !isValidEnvs(envs) || !isValidKeyId(keyId)) {
    return err(configInvalidError());
  }

  let normalizedExtends: readonly string[] | undefined;
  if (extendsValue !== undefined) {
    if (!isValidExtends(extendsValue)) {
      return err(configInvalidError());
    }
    normalizedExtends = extendsValue;
  }

  let normalizedRequiredPairs: readonly [string, string][] | undefined;
  if (requiredPairs !== undefined) {
    if (!isValidRequiredPairs(requiredPairs)) {
      return err(configInvalidError());
    }
    normalizedRequiredPairs = requiredPairs;
  }

  let normalizedCustomDictionary: readonly string[] | undefined;
  if (customDictionary !== undefined) {
    if (!isStringArray(customDictionary)) {
      return err(configInvalidError());
    }
    normalizedCustomDictionary = customDictionary;
  }

  const normalizedConfig: EnvltConfig = {
    appName,
    envs,
    keyId,
    ...(normalizedExtends !== undefined ? { extends: normalizedExtends } : {}),
    ...(normalizedRequiredPairs !== undefined ? { requiredPairs: normalizedRequiredPairs } : {}),
    ...(normalizedCustomDictionary !== undefined
      ? { customDictionary: normalizedCustomDictionary }
      : {}),
  };

  return ok(normalizedConfig);
}

export async function readConfig(
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<EnvltConfig>> {
  const configPath = path.resolve(projectRoot, CONFIG_FILE_NAME);
  const existsResult = await adapter.exists(configPath);
  if (!existsResult.ok) {
    return err(existsResult.error);
  }

  if (!existsResult.value) {
    return err(new AppError(ErrorCode.CONFIG_NOT_FOUND, 'envlt.config.json was not found.'));
  }

  const readResult = await adapter.read(configPath);
  if (!readResult.ok) {
    return err(readResult.error);
  }

  try {
    const parsed = JSON.parse(readResult.value.toString('utf8')) as unknown;
    return validateConfig(parsed);
  } catch (error: unknown) {
    return err(configInvalidError(error));
  }
}

export async function writeConfig(
  config: EnvltConfig,
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<void>> {
  const validated = validateConfig(config);
  if (!validated.ok) {
    return err(validated.error);
  }

  const configPath = path.resolve(projectRoot, CONFIG_FILE_NAME);
  const serialized = `${JSON.stringify(validated.value, null, 2)}\n`;

  try {
    return await adapter.write(configPath, Buffer.from(serialized, 'utf8'));
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(
      new AppError(
        ErrorCode.STORAGE,
        'Failed to write envlt.config.json.',
      ),
    );
  }
}
