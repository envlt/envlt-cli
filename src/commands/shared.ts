import { clearAllCache, clearCachedRepo } from '../shared/cache.js';
import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

export type SharedClearCacheOptions = {
  readonly repo?: string;
};

function parseRepo(value: string): Result<{ readonly org: string; readonly repo: string }> {
  const segments = value.split('/');
  const org = segments[0];
  const repo = segments[1];
  if (
    segments.length !== 2 ||
    org === undefined ||
    repo === undefined ||
    org === '' ||
    repo === ''
  ) {
    return err(new AppError(ErrorCode.CONFIG_INVALID, 'Invalid --repo value. Expected org/repo.'));
  }

  return ok({ org, repo });
}

export async function runSharedClearCache(options: SharedClearCacheOptions): Promise<Result<void>> {
  if (options.repo === undefined) {
    return clearAllCache();
  }

  const parsedRepo = parseRepo(options.repo);
  if (!parsedRepo.ok) {
    return parsedRepo;
  }

  return clearCachedRepo(parsedRepo.value.org, parsedRepo.value.repo);
}
