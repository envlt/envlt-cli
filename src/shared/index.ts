import * as path from 'node:path';

import { parseEnv, type EnvVars } from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { loadKey } from '../keystore.js';
import { err, ok, type Result } from '../result.js';
import type { StorageAdapter } from '../storage/index.js';
import { decrypt } from '../crypto.js';

import { ensureCachedRepo, type GitRunner } from './cache.js';
import { parseExtendsEntry } from './types.js';

async function resolveEntryKey(
  localKeyHex: string,
  keyId: string | undefined,
  cachedRepoPath: string,
): Promise<Result<string>> {
  if (keyId === undefined) {
    return ok(localKeyHex);
  }

  const keyResult = await loadKey(keyId, cachedRepoPath);
  if (!keyResult.ok) {
    return err(keyResult.error);
  }

  return ok(keyResult.value);
}

type EnsureRepo = (
  org: string,
  repo: string,
  cacheDir?: string,
  gitRunner?: GitRunner,
) => Promise<Result<string>>;

async function loadSharedEntry(
  rawEntry: string,
  localKeyHex: string,
  adapter: StorageAdapter,
  cacheDir: string | undefined,
  ensureRepo: EnsureRepo,
): Promise<Result<EnvVars>> {
  const parsedEntry = parseExtendsEntry(rawEntry);
  if (!parsedEntry.ok) {
    return err(parsedEntry.error);
  }

  const cachedRepoResult = await ensureRepo(
    parsedEntry.value.org,
    parsedEntry.value.repo,
    cacheDir,
  );
  if (!cachedRepoResult.ok) {
    return cachedRepoResult;
  }

  const keyResult = await resolveEntryKey(
    localKeyHex,
    parsedEntry.value.keyId,
    cachedRepoResult.value,
  );
  if (!keyResult.ok) {
    return keyResult;
  }

  const encFilePath = path.resolve(cachedRepoResult.value, `${parsedEntry.value.path}.enc`);
  const readResult = await adapter.read(encFilePath);
  if (!readResult.ok) {
    return err(
      new AppError(
        ErrorCode.SHARED_ENTRY_NOT_FOUND,
        `Shared entry not found: ${rawEntry}`,
        readResult.error,
      ),
    );
  }

  try {
    const decrypted = decrypt(readResult.value.toString('utf8'), keyResult.value);
    const parsedEnv = parseEnv(decrypted);
    if (!parsedEnv.ok) {
      return err(parsedEnv.error);
    }

    return ok(parsedEnv.value);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return err(error);
    }

    return err(
      new AppError(ErrorCode.SHARED_PARSE_ERROR, 'Failed to parse shared env entry.', error),
    );
  }
}

export async function resolveExtends(
  entries: readonly string[],
  _envName: string,
  localKeyHex: string,
  adapter: StorageAdapter,
  cacheDir?: string,
  ensureRepo: EnsureRepo = ensureCachedRepo,
): Promise<Result<EnvVars>> {
  const merged: Record<string, string> = {};

  for (const entry of entries) {
    const entryResult = await loadSharedEntry(entry, localKeyHex, adapter, cacheDir, ensureRepo);
    if (!entryResult.ok) {
      return entryResult;
    }

    Object.assign(merged, entryResult.value);
  }

  return ok(merged);
}
