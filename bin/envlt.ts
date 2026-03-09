#!/usr/bin/env node
import * as path from 'node:path';

import { Command } from 'commander';

import { runSet } from '../src/commands/set.js';
import { runUse } from '../src/commands/use.js';
import { DEFAULT_ENV, EXIT_CODES } from '../src/constants.js';
import { logger } from '../src/logger.js';

const program = new Command();
program.name('envlt').description('Encrypted environment variable manager').version('0.1.0');

program
  .command('set')
  .argument('<assignments...>', 'One or more KEY=VALUE assignments')
  .option('--env <name>', 'Environment name', DEFAULT_ENV)
  .option('--key-id <id>', 'Override key ID from config')
  .action(async (assignments: readonly string[], opts: { env: string; keyId?: string }) => {
    const result = await runSet(assignments, {
      env: opts.env,
      ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
      projectRoot: path.resolve(process.cwd()),
    });

    if (!result.ok) {
      logger.error(result.error.message);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

program
  .command('use')
  .option('--env <name>', 'Environment name', DEFAULT_ENV)
  .option('--key-id <id>', 'Override key ID from config')
  .option('--passthrough', 'Inherit parent environment variables', false)
  .argument('<command...>', 'Command and args to run')
  .action(
    async (
      commandArgs: readonly string[],
      opts: { env: string; keyId?: string; passthrough?: boolean },
    ) => {
      if (commandArgs.length === 0) {
        logger.error('Missing command to run.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      const normalizedArgs = commandArgs[0] === '--' ? commandArgs.slice(1) : commandArgs;
      const command = normalizedArgs[0];
      if (command === undefined) {
        logger.error('Missing command to run.');
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      await runUse([command, ...normalizedArgs.slice(1)], {
        env: opts.env,
        ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
        ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
        projectRoot: path.resolve(process.cwd()),
      });
    },
  );

program.parse();
