import { installPreCommitHook, isHookInstalled, uninstallPreCommitHook } from '../hooks/install.js';
import { logger } from '../logger.js';
import { err, ok, type Result } from '../result.js';

export type HooksInstallOptions = {
  readonly force?: boolean;
  readonly projectRoot: string;
};

export type HooksUninstallOptions = {
  readonly projectRoot: string;
};

export type HooksStatusOptions = {
  readonly projectRoot: string;
};

export async function runHooksInstall(options: HooksInstallOptions): Promise<Result<void>> {
  const result = await installPreCommitHook({
    projectRoot: options.projectRoot,
    ...(options.force !== undefined ? { force: options.force } : {}),
  });
  if (!result.ok) {
    return err(result.error);
  }

  if (result.value.status === 'installed') {
    logger.success('✓ Installed pre-commit hook.');
    return ok(undefined);
  }

  if (result.value.status === 'updated') {
    logger.success('✓ Updated pre-commit hook.');
    return ok(undefined);
  }

  if (result.value.reason === 'not_a_git_repo') {
    logger.warn('No .git directory found. Skipped hook installation.');
  } else {
    logger.warn('Pre-commit hook already exists. Use --force to update.');
  }

  return ok(undefined);
}

export async function runHooksUninstall(options: HooksUninstallOptions): Promise<Result<void>> {
  const uninstallResult = await uninstallPreCommitHook(options.projectRoot);
  if (!uninstallResult.ok) {
    return err(uninstallResult.error);
  }

  logger.success('✓ Uninstalled pre-commit hook.');
  return ok(undefined);
}

export async function runHooksStatus(options: HooksStatusOptions): Promise<Result<void>> {
  const installed = await isHookInstalled(options.projectRoot);
  if (installed) {
    logger.info('Pre-commit hook is installed.');
  } else {
    logger.info('Pre-commit hook is not installed.');
  }

  return ok(undefined);
}
