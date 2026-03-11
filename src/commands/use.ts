import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { EXIT_CODES } from '../constants.js';
import { readConfig } from '../config.js';
import { readEncEnv } from '../envfile.js';
import { loadKey } from '../keystore.js';
import { logger } from '../logger.js';
import { resolveExtends } from '../shared/index.js';
import { createFilesystemAdapter } from '../storage/index.js';

export type UseOptions = {
  readonly env: string;
  readonly projectRoot: string;
  readonly keyId?: string;
  readonly passthrough?: boolean;
  readonly strictShared?: boolean;
};

function createChildEnv(
  passthrough: boolean,
  decryptedVars: Readonly<Record<string, string>>,
  projectRoot: string,
): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = passthrough ? { ...process.env } : {};
  for (const [key, value] of Object.entries(decryptedVars)) {
    baseEnv[key] = value;
  }

  // Add node_modules/.bin to PATH so npm scripts work
  const nodeModulesBin = join(projectRoot, 'node_modules', '.bin');
  const existingPath = baseEnv['PATH'] ?? process.env['PATH'] ?? '';
  baseEnv['PATH'] = existingPath ? `${nodeModulesBin}:${existingPath}` : nodeModulesBin;

  return baseEnv;
}

export async function runUse(
  command: readonly [string, ...string[]],
  options: UseOptions,
): Promise<number> {
  const adapter = createFilesystemAdapter(options.projectRoot);
  const configResult = await readConfig(options.projectRoot, adapter);
  if (!configResult.ok) {
    logger.error(configResult.error.message);
    return EXIT_CODES.MISSING_CONFIG;
  }

  const keyId = options.keyId ?? configResult.value.keyId;
  const keyResult = await loadKey(keyId);
  if (!keyResult.ok) {
    logger.error(keyResult.error.message);
    return EXIT_CODES.DECRYPTION_FAILED;
  }

  const envResult = await readEncEnv(options.env, keyResult.value, options.projectRoot, adapter);
  if (!envResult.ok) {
    logger.error(envResult.error.message);
    return EXIT_CODES.DECRYPTION_FAILED;
  }

  let mergedVars = envResult.value;

  if (configResult.value.extends !== undefined && configResult.value.extends.length > 0) {
    const sharedResult = await resolveExtends(
      configResult.value.extends,
      options.env,
      keyResult.value,
      createFilesystemAdapter('/'),
    );

    if (!sharedResult.ok) {
      if (options.strictShared ?? false) {
        logger.error(sharedResult.error.message);
        return EXIT_CODES.DECRYPTION_FAILED;
      }

      logger.warn(`Shared secrets unavailable: ${sharedResult.error.message}`);
    } else {
      mergedVars = { ...sharedResult.value, ...envResult.value };
    }
  }

  return await new Promise<number>((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      env: createChildEnv(options.passthrough ?? false, mergedVars, options.projectRoot),
      stdio: 'inherit',
    });

    child.on('close', (code: number | null) => {
      resolve(code ?? EXIT_CODES.GENERAL_ERROR);
    });
    child.on('error', (error: Error) => {
      logger.error(error.message);
      resolve(EXIT_CODES.CHILD_PROCESS_ERROR);
    });
  });
}
