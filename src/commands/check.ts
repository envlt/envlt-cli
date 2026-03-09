import * as path from 'node:path';

import { EXIT_CODES } from '../constants.js';
import { readConfig } from '../config.js';
import { encEnvFileName, readEncEnv, type EnvVars } from '../envfile.js';
import { err, ok, type Result } from '../result.js';
import { loadKey } from '../keystore.js';
import { logger } from '../logger.js';
import { readManifest, validateManifest, type ManifestViolation } from '../manifest.js';
import { createFilesystemAdapter } from '../storage/index.js';

export interface CheckOptions {
  readonly env: string;
  readonly projectRoot: string;
  readonly keyId?: string;
  readonly strict?: boolean;
  readonly exitOnFailure?: boolean;
}

export async function runCheck(
  options: CheckOptions,
): Promise<Result<readonly ManifestViolation[]>> {
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

  const manifestResult = await readManifest(options.projectRoot, adapter);
  if (!manifestResult.ok) {
    return err(manifestResult.error);
  }

  const envPath = path.resolve(options.projectRoot, encEnvFileName(options.env));
  const existsResult = await adapter.exists(envPath);
  if (!existsResult.ok) {
    return err(existsResult.error);
  }

  let vars: EnvVars = {};
  if (existsResult.value) {
    const envResult = await readEncEnv(options.env, keyResult.value, options.projectRoot, adapter);
    if (!envResult.ok) {
      return err(envResult.error);
    }
    vars = envResult.value;
  }

  const violations = validateManifest(
    manifestResult.value,
    vars,
    options.env,
    options.strict ?? false,
  );

  if (violations.length === 0) {
    logger.success('✓ All declared variables are set');
    return ok(violations);
  }

  for (const violation of violations) {
    if (violation.type === 'missing_required') {
      logger.error(`✗ ${violation.key} — declared but not set`);
      continue;
    }

    logger.warn(`⚠ ${violation.key} — not declared in manifest`);
  }

  const hasMissingRequired = violations.some((violation) => violation.type === 'missing_required');
  if (hasMissingRequired && (options.exitOnFailure ?? true)) {
    process.exitCode = EXIT_CODES.CHECK_FAILED;
  }

  return ok(violations);
}
