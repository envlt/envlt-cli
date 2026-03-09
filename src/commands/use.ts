import { spawn } from 'node:child_process';
import { exit as processExit } from 'node:process';

import { EXIT_CODES } from '../constants.js';
import { readConfig } from '../config.js';
import { readEncEnv } from '../envfile.js';
import { loadKey } from '../keystore.js';
import { logger } from '../logger.js';
import { createFilesystemAdapter } from '../storage/index.js';

export type UseOptions = {
  readonly env: string;
  readonly projectRoot: string;
  readonly keyId?: string;
  readonly passthrough?: boolean;
};

function createChildEnv(
  passthrough: boolean,
  decryptedVars: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = passthrough ? { ...process.env } : {};
  for (const [key, value] of Object.entries(decryptedVars)) {
    baseEnv[key] = value;
  }

  return baseEnv;
}

export async function runUse(
  command: readonly [string, ...string[]],
  options: UseOptions,
): Promise<never> {
  const adapter = createFilesystemAdapter(options.projectRoot);
  const configResult = await readConfig(options.projectRoot, adapter);
  if (!configResult.ok) {
    logger.error(configResult.error.message);
    return processExit(EXIT_CODES.MISSING_CONFIG);
  }

  const keyId = options.keyId ?? configResult.value.keyId;
  const keyResult = await loadKey(keyId);
  if (!keyResult.ok) {
    logger.error(keyResult.error.message);
    return processExit(EXIT_CODES.DECRYPTION_FAILED);
  }

  const envResult = await readEncEnv(options.env, keyResult.value, options.projectRoot, adapter);
  if (!envResult.ok) {
    logger.error(envResult.error.message);
    return processExit(EXIT_CODES.DECRYPTION_FAILED);
  }

  const child = spawn(command[0], command.slice(1), {
    env: createChildEnv(options.passthrough ?? false, envResult.value),
    stdio: 'inherit',
  });

  child.on('close', (code: number | null) => {
    processExit(code ?? EXIT_CODES.GENERAL_ERROR);
  });
  child.on('error', (error: Error) => {
    logger.error(error.message);
    processExit(EXIT_CODES.CHILD_PROCESS_ERROR);
  });

  return new Promise<never>(() => {
    // Never resolve because runUse always exits the process.
  });
}
