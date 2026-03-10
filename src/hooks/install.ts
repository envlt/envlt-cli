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
const HOOK_HEADER = '#!/bin/sh';
const HOOK_COMMAND = 'npx --no-install envlt check';
const GITDIR_PREFIX = 'gitdir:';
const PREPENDED_TMP_FILE = '.envlt-pre-commit.original.tmp';
const HOOK_FILE_NAME = 'pre-commit';
const HOOK_BODY_LINES = [
  HOOK_MARKER,
  '# This hook was installed by envlt. To uninstall: envlt hooks uninstall',
  'set -e',
  HOOK_COMMAND,
] as const;

function managedHookContent(): string {
  return `${HOOK_HEADER}\n${HOOK_BODY_LINES.join('\n')}\n`;
}

function prependedHookContent(originalContent: string): string {
  return [
    HOOK_HEADER,
    PREPENDED_MARKER,
    'set -e',
    HOOK_COMMAND,
    `__ENVLT_ORIGINAL_HOOK="$(mktemp "${PREPENDED_TMP_FILE}.XXXXXX")"`,
    'cat > "$__ENVLT_ORIGINAL_HOOK" <<\'ENVLT_ORIGINAL_HOOK\'',
    originalContent,
    'ENVLT_ORIGINAL_HOOK',
    'chmod 755 "$__ENVLT_ORIGINAL_HOOK"',
    '"$__ENVLT_ORIGINAL_HOOK"',
    'rm -f "$__ENVLT_ORIGINAL_HOOK"',
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

async function resolveGitDirectory(projectRoot: string): Promise<Result<string | undefined>> {
  const gitEntryPath = path.resolve(projectRoot, '.git');
  try {
    const stat = await fs.stat(gitEntryPath);
    if (stat.isDirectory()) {
      return ok(gitEntryPath);
    }

    if (!stat.isFile()) {
      return ok(undefined);
    }

    const pointer = await fs.readFile(gitEntryPath, 'utf8');
    const firstLine = pointer.split(/\r?\n/u).at(0)?.trim() ?? '';
    if (!firstLine.startsWith(GITDIR_PREFIX)) {
      return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Invalid .git file format.'));
    }

    const rawPath = firstLine.slice(GITDIR_PREFIX.length).trim();
    if (rawPath === '') {
      return err(new AppError(ErrorCode.STORAGE_READ_ERROR, 'Invalid .git file format.'));
    }

    return ok(path.resolve(projectRoot, rawPath));
  } catch (error: unknown) {
    if (isMissing(error)) {
      return ok(undefined);
    }

    return err(
      new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to resolve .git directory.', error),
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

function hookPathFromGitDirectory(gitDirectory: string): string {
  return path.join(gitDirectory, 'hooks', HOOK_FILE_NAME);
}

export async function installPreCommitHook(
  options: HookInstallOptions,
): Promise<Result<HookInstallResult>> {
  const gitDirectoryResult = await resolveGitDirectory(options.projectRoot);
  if (!gitDirectoryResult.ok) {
    return err(gitDirectoryResult.error);
  }

  if (gitDirectoryResult.value === undefined) {
    return ok({ status: 'skipped', reason: 'not_a_git_repo' });
  }

  const preCommitPath = hookPathFromGitDirectory(gitDirectoryResult.value);
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
  const gitDirectoryResult = await resolveGitDirectory(projectRoot);
  if (!gitDirectoryResult.ok || gitDirectoryResult.value === undefined) {
    return false;
  }

  const contentResult = await readHookIfExists(hookPathFromGitDirectory(gitDirectoryResult.value));
  if (!contentResult.ok || contentResult.value === undefined) {
    return false;
  }

  return isManagedHook(contentResult.value);
}

export async function uninstallPreCommitHook(projectRoot: string): Promise<Result<void>> {
  const gitDirectoryResult = await resolveGitDirectory(projectRoot);
  if (!gitDirectoryResult.ok) {
    return err(gitDirectoryResult.error);
  }

  if (gitDirectoryResult.value === undefined) {
    return ok(undefined);
  }

  const preCommitPath = hookPathFromGitDirectory(gitDirectoryResult.value);
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
