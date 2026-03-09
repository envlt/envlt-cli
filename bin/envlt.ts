#!/usr/bin/env node
import * as path from 'node:path';

import { Command } from 'commander';

import { runCheck } from '../src/commands/check.js';
import { readConfig } from '../src/config.js';
import { runDeclare } from '../src/commands/declare.js';
import { runEdit } from '../src/commands/edit.js';
import { runSet } from '../src/commands/set.js';
import { runUse } from '../src/commands/use.js';
import { DEFAULT_ENV, EXIT_CODES } from '../src/constants.js';
import { logger } from '../src/logger.js';
import { createFilesystemAdapter } from '../src/storage/index.js';

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
  .command('declare')
  .argument('<key>', 'Environment variable key to declare')
  .requiredOption('--description <value>', 'Variable description')
  .option('--env <name>', 'Only require this key in the given environment')
  .option('--required', 'Mark variable as required', true)
  .option('--no-required', 'Mark variable as optional')
  .option('--secret', 'Mark variable as secret', true)
  .option('--no-secret', 'Mark variable as non-secret')
  .action(
    async (
      key: string,
      opts: { env?: string; description: string; required: boolean; secret: boolean },
    ) => {
      const projectRoot = path.resolve(process.cwd());
      const adapter = createFilesystemAdapter(projectRoot);
      const configResult = await readConfig(projectRoot, adapter);
      if (!configResult.ok) {
        logger.error(configResult.error.message);
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }

      const result = await runDeclare(key, {
        description: opts.description,
        ...(opts.env !== undefined ? { env: opts.env } : {}),
        required: opts.required,
        secret: opts.secret,
        ...(configResult.value.customDictionary !== undefined
          ? { customDictionary: configResult.value.customDictionary }
          : {}),
        projectRoot,
      });

      if (!result.ok) {
        logger.error(result.error.message);
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    },
  );

program
  .command('check')
  .option('--env <name>', 'Environment name', DEFAULT_ENV)
  .option('--strict', 'Also report undeclared variables', false)
  .option('--key-id <id>', 'Override key ID from config')
  .action(async (opts: { env: string; strict: boolean; keyId?: string }) => {
    const result = await runCheck({
      env: opts.env,
      strict: opts.strict,
      ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
      projectRoot: path.resolve(process.cwd()),
    });

    if (!result.ok) {
      logger.error(result.error.message);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

program
  .command('edit')
  .option('--env <name>', 'Environment name', DEFAULT_ENV)
  .option('--key-id <id>', 'Override key ID from config')
  .option('--editor <path>', 'Override editor command')
  .action(async (opts: { env: string; keyId?: string; editor?: string }) => {
    const result = await runEdit({
      env: opts.env,
      ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
      ...(opts.editor !== undefined ? { editor: opts.editor } : {}),
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

      const exitCode = await runUse([command, ...normalizedArgs.slice(1)], {
        env: opts.env,
        ...(opts.keyId !== undefined ? { keyId: opts.keyId } : {}),
        ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
        projectRoot: path.resolve(process.cwd()),
      });
      process.exit(exitCode);
    },
  );

program.parse();
