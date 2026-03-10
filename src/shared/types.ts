import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

export type ExtendsEntry = {
  readonly type: 'github';
  readonly org: string;
  readonly repo: string;
  readonly path: string;
  readonly keyId?: string;
};

const GITHUB_ENTRY_PATTERN = /^github:([^/\s]+)\/([^/\s]+)\/(.+)$/u;

function createInvalidExtendsEntryError(raw: string): AppError {
  return new AppError(
    ErrorCode.CONFIG_INVALID,
    `Invalid extends entry: "${raw}". Expected format: github:org/repo/path.`,
  );
}

export function parseExtendsEntry(raw: string): Result<ExtendsEntry> {
  if (raw.trim() === '') {
    return err(createInvalidExtendsEntryError(raw));
  }

  const match = GITHUB_ENTRY_PATTERN.exec(raw);
  if (match === null) {
    return err(createInvalidExtendsEntryError(raw));
  }

  const org = match[1];
  const repo = match[2];
  const entryPath = match[3];

  if (org === undefined || repo === undefined || entryPath === undefined || entryPath === '') {
    return err(createInvalidExtendsEntryError(raw));
  }

  return ok({
    type: 'github',
    org,
    repo,
    path: entryPath,
  });
}
