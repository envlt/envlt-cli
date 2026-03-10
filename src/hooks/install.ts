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
const ORIGINAL_MODE_MARKER = '# Original hook mode:';
const ORIGINAL_B64_MARKER = '# Original hook base64:';
const HOOK_HEADER = '#!/bin/sh';
const HOOK_COMMAND = 'npx --no-install envlt check';
const GITDIR_PREFIX = 'gitdir:';
const PREPENDED_TMP_FILE = '.envlt-pre-commit.original.tmp';
const HOOK_FILE_NAME = 'pre-commit';
const PREPENDED_B64_PREFIX = '__ENVLT_ORIGINAL_HOOK_B64=';
const HOOK_BODY_LINES = [
  HOOK_MARKER,
  '# This hook was installed by envlt. To uninstall: envlt hooks uninstall',
  'set -e',
  HOOK_COMMAND,
] as const;

type HookReadResult = {
  readonly content: string;
  readonly mode: number;
};

type PreservedOriginalHook = {
  readonly content: string;
  readonly mode?: number;
};

function managedHookContent(): string {
  return `${HOOK_HEADER}\n${HOOK_BODY_LINES.join('\n')}\n`;
}

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function decodeBase64(value: string): Result<string> {
  try {
    return ok(Buffer.from(value, 'base64').toString('utf8'));
  } catch (error: unknown) {
    return err(
      new AppError(
        ErrorCode.STORAGE_READ_ERROR,
        'Invalid envlt prepended hook format. Could not decode preserved hook.',
        error,
      ),
    );
  }
}

function prependedHookContent(original: PreservedOriginalHook): string {
  const originalMode = original.mode?.toString(8);
  const encodedOriginal = encodeBase64(original.content);

  return [
    HOOK_HEADER,
    PREPENDED_MARKER,
    'set -e',
    HOOK_COMMAND,
    `${PREPENDED_B64_PREFIX}'${encodedOriginal}'`,
    `__ENVLT_ORIGINAL_HOOK="$(mktemp "${PREPENDED_TMP_FILE}.XXXXXX")"`,
    'trap \"rm -f \\\"$__ENVLT_ORIGINAL_HOOK\\\"\" EXIT',
    'if ! printf "%s" "$__ENVLT_ORIGINAL_HOOK_B64" | base64 -d > "$__ENVLT_ORIGINAL_HOOK" 2>/dev/null; then',
    '  printf "%s" "$__ENVLT_ORIGINAL_HOOK_B64" | base64 -D > "$__ENVLT_ORIGINAL_HOOK"',
    'fi',
    'chmod 755 "$__ENVLT_ORIGINAL_HOOK"',
    '"$__ENVLT_ORIGINAL_HOOK"',
    'exit 0',
    '',
    ...(originalMode !== undefined ? [`${ORIGINAL_MODE_MARKER} ${originalMode}`] : []),
    ORIGINAL_HOOK_MARKER,
    `${ORIGINAL_B64_MARKER} ${encodedOriginal}`,
  ].join('\n');
}

function extractOriginalFromPrepended(content: string): Result<PreservedOriginalHook> {
  const markerIndex = content.indexOf(`${ORIGINAL_HOOK_MARKER}\n`);
  if (markerIndex < 0) {
    return err(
      new AppError(
        ErrorCode.STORAGE_READ_ERROR,
        'Invalid envlt prepended hook format. Could not locate preserved original hook.',
      ),
    );
  }

  const modeLine = content
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`${ORIGINAL_MODE_MARKER} `));
  const parsedMode = modeLine?.slice(`${ORIGINAL_MODE_MARKER} `.length).trim();
  const mode =
    parsedMode !== undefined && /^[0-7]{3,4}$/u.test(parsedMode)
      ? Number.parseInt(parsedMode, 8)
      : undefined;

  const preservedSection = content.slice(markerIndex + `${ORIGINAL_HOOK_MARKER}\n`.length);
  const encodedLine = preservedSection
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`${ORIGINAL_B64_MARKER} `));
  if (encodedLine === undefined) {
    return err(
      new AppError(
        ErrorCode.STORAGE_READ_ERROR,
        'Invalid envlt prepended hook format. Could not locate preserved hook payload.',
      ),
    );
  }

  const encodedValue = encodedLine.slice(`${ORIGINAL_B64_MARKER} `.length).trim();
  const decoded = decodeBase64(encodedValue);
  if (!decoded.ok) {
    return err(decoded.error);
  }

  return ok({
    content: decoded.value,
    ...(mode !== undefined ? { mode } : {}),
  });
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

async function writeHook(
  filePath: string,
  content: string,
  mode: number = HOOK_MODE,
): Promise<Result<void>> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, { mode });
    await fs.chmod(filePath, mode);
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      new AppError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to write pre-commit hook.', error),
    );
  }
}

async function readHookIfExists(filePath: string): Promise<Result<HookReadResult | undefined>> {
  try {
    const [content, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
    return ok({ content, mode: stat.mode & 0o777 });
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

    const resolvedGitDirectory = path.resolve(projectRoot, rawPath);
    const gitDirectoryStat = await fs.stat(resolvedGitDirectory).catch((error: unknown) => {
      if (isMissing(error)) {
        return undefined;
      }

      throw error;
    });

    if (gitDirectoryStat === undefined || !gitDirectoryStat.isDirectory()) {
      return ok(undefined);
    }

    return ok(resolvedGitDirectory);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return ok(undefined);
    }

    return err(
      new AppError(ErrorCode.STORAGE_READ_ERROR, 'Failed to resolve .git directory.', error),
    );
  }
}

function withUpdateContent(existing: HookReadResult): Result<string> {
  if (!isManagedHook(existing.content)) {
    return ok(prependedHookContent({ content: existing.content, mode: existing.mode }));
  }

  if (!isPrependedHook(existing.content)) {
    return ok(managedHookContent());
  }

  const originalResult = extractOriginalFromPrepended(existing.content);
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

  return isManagedHook(contentResult.value.content);
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

  if (!isManagedHook(contentResult.value.content)) {
    return err(
      new AppError(
        ErrorCode.STORAGE_DELETE_ERROR,
        'Refusing to remove pre-commit hook not installed by envlt.',
      ),
    );
  }

  if (isPrependedHook(contentResult.value.content)) {
    const originalResult = extractOriginalFromPrepended(contentResult.value.content);
    if (!originalResult.ok) {
      return err(originalResult.error);
    }

    const restoreMode = originalResult.value.mode ?? contentResult.value.mode;
    return writeHook(preCommitPath, originalResult.value.content, restoreMode);
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
