import { logger } from '../logger.js';
import { readManifest, upsertEntry, writeManifest } from '../manifest.js';
import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter } from '../storage/index.js';
import { validateKey } from '../validation/keys.js';

export type DeclareOptions = {
  readonly env?: string;
  readonly description: string;
  readonly required?: boolean;
  readonly secret?: boolean;
  readonly projectRoot: string;
  readonly customDictionary?: readonly string[];
};

export async function runDeclare(key: string, options: DeclareOptions): Promise<Result<void>> {
  const validationResult = validateKey(key, options.customDictionary);
  if (!validationResult.valid) {
    return err(new AppError(ErrorCode.DECLARE_INVALID_KEY, validationResult.error));
  }

  for (const warning of validationResult.warnings) {
    logger.warn(warning);
  }

  const adapter = createFilesystemAdapter(options.projectRoot);
  const manifestResult = await readManifest(options.projectRoot, adapter);
  if (!manifestResult.ok) {
    return err(manifestResult.error);
  }

  const entry = {
    key,
    description: options.description,
    required: options.required ?? true,
    secret: options.secret ?? true,
    ...(options.env !== undefined ? { envs: [options.env] } : {}),
  };

  const updatedManifest = upsertEntry(manifestResult.value, entry);
  const writeResult = await writeManifest(updatedManifest, options.projectRoot, adapter);
  if (!writeResult.ok) {
    return err(writeResult.error);
  }

  logger.success(`✓ Declared ${key} in manifest`);
  return ok(undefined);
}
