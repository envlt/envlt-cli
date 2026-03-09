import * as path from 'node:path';

import type { EnvVars } from './envfile.js';
import { AppError, ErrorCode } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { StorageAdapter } from './storage/index.js';
import { isObjectRecord } from './validation/guards.js';

export type ManifestEntry = {
  readonly key: string;
  readonly description: string;
  readonly required: boolean;
  readonly envs?: readonly string[];
  readonly secret: boolean;
};

export type Manifest = {
  readonly version: 1;
  readonly entries: readonly ManifestEntry[];
};

export type ManifestViolation = {
  readonly key: string;
  readonly type: 'missing_required' | 'undeclared';
};

const MANIFEST_FILE_NAME = 'envlt.manifest.json';
const MANIFEST_VERSION = 1;

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (!isObjectRecord(value)) {
    return false;
  }

  const key = value['key'];
  const description = value['description'];
  const required = value['required'];
  const secret = value['secret'];
  const envs = value['envs'];

  const hasValidEnvs =
    envs === undefined || (Array.isArray(envs) && envs.every((entry) => typeof entry === 'string'));

  return (
    typeof key === 'string' &&
    typeof description === 'string' &&
    typeof required === 'boolean' &&
    typeof secret === 'boolean' &&
    hasValidEnvs
  );
}

function validateManifestData(raw: unknown): Result<Manifest> {
  if (!isObjectRecord(raw)) {
    return err(new AppError(ErrorCode.CONFIG_INVALID, 'Invalid envlt.manifest.json file.'));
  }

  const version = raw['version'];
  const entries = raw['entries'];

  if (version !== MANIFEST_VERSION || !Array.isArray(entries) || !entries.every(isManifestEntry)) {
    return err(new AppError(ErrorCode.CONFIG_INVALID, 'Invalid envlt.manifest.json file.'));
  }

  return ok({ version: MANIFEST_VERSION, entries });
}

export async function readManifest(
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<Manifest>> {
  const manifestPath = path.resolve(projectRoot, MANIFEST_FILE_NAME);
  const existsResult = await adapter.exists(manifestPath);
  if (!existsResult.ok) {
    return err(existsResult.error);
  }

  if (!existsResult.value) {
    return ok({ version: MANIFEST_VERSION, entries: [] });
  }

  const readResult = await adapter.read(manifestPath);
  if (!readResult.ok) {
    return err(readResult.error);
  }

  try {
    const parsed = JSON.parse(readResult.value.toString('utf8')) as unknown;
    return validateManifestData(parsed);
  } catch (error: unknown) {
    return err(new AppError(ErrorCode.CONFIG_INVALID, 'Invalid envlt.manifest.json file.', error));
  }
}

export async function writeManifest(
  manifest: Manifest,
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<void>> {
  const sortedEntries = [...manifest.entries].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const output: Manifest = { version: MANIFEST_VERSION, entries: sortedEntries };
  const manifestPath = path.resolve(projectRoot, MANIFEST_FILE_NAME);
  const serialized = `${JSON.stringify(output, null, 2)}
`;

  return adapter.write(manifestPath, Buffer.from(serialized, 'utf8'));
}

export function upsertEntry(manifest: Manifest, entry: ManifestEntry): Manifest {
  const existingIndex = manifest.entries.findIndex((existing) => existing.key === entry.key);
  if (existingIndex < 0) {
    return { version: MANIFEST_VERSION, entries: [...manifest.entries, entry] };
  }

  const nextEntries = manifest.entries.map((existing, index) =>
    index === existingIndex ? entry : existing,
  );
  return { version: MANIFEST_VERSION, entries: nextEntries };
}

export function validateManifest(
  manifest: Manifest,
  vars: EnvVars,
  envName: string,
  strict = false,
): readonly ManifestViolation[] {
  const scopedEntries = manifest.entries.filter(
    (entry) => entry.envs === undefined || entry.envs.includes(envName),
  );

  const missingRequired: ManifestViolation[] = scopedEntries
    .filter((entry) => entry.required && vars[entry.key] === undefined)
    .map((entry) => ({ key: entry.key, type: 'missing_required' }));

  if (!strict) {
    return missingRequired;
  }

  const declaredKeys = new Set(scopedEntries.map((entry) => entry.key));
  const undeclared: ManifestViolation[] = Object.keys(vars)
    .filter((key) => !declaredKeys.has(key))
    .map((key) => ({ key, type: 'undeclared' }));

  return [...missingRequired, ...undeclared];
}
