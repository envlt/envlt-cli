import { EXIT_CODES } from '../constants.js';
import { readConfig } from '../config.js';
import { readEncEnv, resolveEncEnvPath, type EnvVars } from '../envfile.js';
import { loadKey } from '../keystore.js';
import { logger } from '../logger.js';
import { readManifest, validateManifest } from '../manifest.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';
import { checkRequiredPairs } from '../validation/pairs.js';

export type CheckOptions = {
  readonly env: string;
  readonly projectRoot: string;
  readonly keyId?: string;
  readonly strict?: boolean;
  readonly exitOnFailure?: boolean;
};

export type CheckViolation =
  | { readonly type: 'missing_required'; readonly key: string }
  | { readonly type: 'undeclared'; readonly key: string }
  | { readonly type: 'missing_pair'; readonly presentKey: string; readonly missingKey: string };

export async function runCheck(options: CheckOptions): Promise<Result<readonly CheckViolation[]>> {
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

  const envPathResult = resolveEncEnvPath(options.env, options.projectRoot);
  if (!envPathResult.ok) {
    return err(envPathResult.error);
  }

  const existsResult = await adapter.exists(envPathResult.value);
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

  const manifestViolations = validateManifest(
    manifestResult.value,
    vars,
    options.env,
    options.strict ?? false,
  );
  const pairViolations = checkRequiredPairs(vars, configResult.value.requiredPairs ?? []);
  const pairCheckViolations: readonly CheckViolation[] = pairViolations.map(
    (violation): CheckViolation => ({
      type: 'missing_pair',
      presentKey: violation.presentKey,
      missingKey: violation.missingKey,
    }),
  );
  const violations: readonly CheckViolation[] = [...manifestViolations, ...pairCheckViolations];

  if (violations.length === 0) {
    logger.success('✓ All declared variables are set');
    return ok(violations);
  }

  for (const violation of violations) {
    if (violation.type === 'missing_required') {
      logger.error(`✗ ${violation.key} — declared but not set`);
      continue;
    }

    if (violation.type === 'missing_pair') {
      logger.error(`✗ ${violation.presentKey} is set but ${violation.missingKey} is missing`);
      continue;
    }

    logger.warn(`⚠ ${violation.key} — not declared in manifest`);
  }

  const shouldExitOnFailure = options.exitOnFailure ?? true;
  if (shouldExitOnFailure) {
    process.exitCode = EXIT_CODES.CHECK_FAILED;
  }

  return ok(violations);
}
