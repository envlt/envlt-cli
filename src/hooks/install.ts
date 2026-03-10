import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

export type HookInstallOptions = {
  readonly projectRoot: string;
  readonly force?: boolean;
};

export type HookInstallResult =
  | { readonly status: 'installed' }
  | { readonly status: 'skipped'; readonly reason: 'already_exists' | 'not_a_git_repo' }
  | { readonly status: 'updated' };

const HOOK_MODE = 0o755;
const HOOK_MARKER = '# envlt:pre-commit';
const PREPENDED_MARKER = '# envlt:pre-commit (prepended)';
const ORIGINAL_HOOK_MARKER = '# Original hook follows:';
const HOOK_RELATIVE_PATH = path.join('.git', 'hooks', 'pre-commit');
const HOOK_HEADER = '#!/bin/sh';
const HOOK_COMMAND = 'npx --no-install envlt check';
const HOOK_BODY_LINES = [
  HOOK_MARKER,
  '# This hook was installed by envlt. To uninstall: envlt hooks uninstall',
  'set -e',
  HOOK_COMMAND,
] as const;

function hookPath(projectRoot: string): string {
  return path.resolve(projectRoot, HOOK_RELATIVE_PATH);
}

function gitDirectoryPath(projectRoot: string): string {
  return path.resolve(projectRoot, '.git');
}

function managedHookContent(): string {
  return `${HOOK_HEADER}\n${HOOK_BODY_LINES.join('\n')}\n`;
}

function prependedHookContent(originalContent: string): string {
  return [
    HOOK_HEADER,
    PREPENDED_MARKER,
    HOOK_COMMAND,
    '',
    ORIGINAL_HOOK_MARKER,
    originalContent,
  ].join('\n');
}

function extractOriginalFromPrepended(content: string): Result<string> {
  const markerIndex = content.indexOf(`${ORIGINAL_HOOK_MARKER}\n`);
  if (markerIndex < 0) {
    return err(
      new AppError(
        ErrorCode.STORAGE_READ_ERROR,
        'Invalid envlt prepended hook format. Could not locate preserved original hook.',
      ),
    );
  }

  return ok(content.slice(markerIndex + `${ORIGINAL_HOOK_MARKER}\n`.length));
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';
}

function isPrependedHook(content: string): boolean {
  return content.includes(PREPENDED_MARKER);
}

function isManagedHook(content: string): boolean {
  return content.includes(HOOK_MARKER);
}

async function writeHook(filePath: string, content: string): Promise<Result<void>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, { mode: HOOK_MODE });
    await fs.chmod(filePath, HOOK_MODE);
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write pre-commit hook.', error),
    );
  }
}

async function readHookIfExists(filePath: string): Promise<Result<string | undefined>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return ok(content);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return ok(undefined);
    }

    return err(
      new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to read pre-commit hook.', error),
    );
  }
}

function withUpdateContent(existing: string): Result<string> {
  if (!isManagedHook(existing)) {
    return ok(prependedHookContent(existing));
  }

  if (!isPrependedHook(existing)) {
    return ok(managedHookContent());
  }

  const originalResult = extractOriginalFromPrepended(existing);
  if (!originalResult.ok) {
    return err(originalResult.error);
  }

  return ok(prependedHookContent(originalResult.value));
}

export async function installPreCommitHook(
  options: HookInstallOptions,
): Promise<Result<HookInstallResult>> {
  const gitPath = gitDirectoryPath(options.projectRoot);
  try {
    await fs.access(gitPath);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return ok({ status: 'skipped', reason: 'not_a_git_repo' });
    }

    return err(
      new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to access .git directory.', error),
    );
  }

  const preCommitPath = hookPath(options.projectRoot);
  const existing = await readHookIfExists(preCommitPath);
  if (!existing.ok) {
    return err(existing.error);
  }

  if (existing.value === undefined) {
    const writeResult = await writeHook(preCommitPath, managedHookContent());
    if (!writeResult.ok) {
      return err(writeResult.error);
    }

    return ok({ status: 'installed' });
  }

  if (options.force !== true) {
    return ok({ status: 'skipped', reason: 'already_exists' });
  }

  const nextContent = withUpdateContent(existing.value);
  if (!nextContent.ok) {
    return err(nextContent.error);
  }

  const writeResult = await writeHook(preCommitPath, nextContent.value);
  if (!writeResult.ok) {
    return err(writeResult.error);
  }

  return ok({ status: 'updated' });
}

export async function isHookInstalled(projectRoot: string): Promise<boolean> {
  const contentResult = await readHookIfExists(hookPath(projectRoot));
  if (!contentResult.ok || contentResult.value === undefined) {
    return false;
  }

  return isManagedHook(contentResult.value);
}

export async function uninstallPreCommitHook(projectRoot: string): Promise<Result<void>> {
  const preCommitPath = hookPath(projectRoot);
  const contentResult = await readHookIfExists(preCommitPath);
  if (!contentResult.ok) {
    return err(contentResult.error);
  }

  if (contentResult.value === undefined) {
    return ok(undefined);
  }

  if (!isManagedHook(contentResult.value)) {
    return err(
      new AppError(
        ErrorCode.STORAGE_DELETE_ERROR,
        'Refusing to remove pre-commit hook not installed by envlt.',
      ),
    );
  }

  if (isPrependedHook(contentResult.value)) {
    const originalResult = extractOriginalFromPrepended(contentResult.value);
    if (!originalResult.ok) {
      return err(originalResult.error);
    }

    return writeHook(preCommitPath, originalResult.value);
  }

  try {
    await fs.rm(preCommitPath);
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_DELETE_ERROR, 'Failed to remove pre-commit hook.', error),
    );
  }
}
