import { runUse } from '../../src/commands/use.js';

function parseCommand(raw: string | undefined): readonly [string, ...string[]] {
  if (raw === undefined) {
    throw new Error('Missing ENVLT_TEST_USE_COMMAND');
  }

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ENVLT_TEST_USE_COMMAND must be a non-empty string array');
  }

  if (!parsed.every((item) => typeof item === 'string')) {
    throw new Error('ENVLT_TEST_USE_COMMAND entries must be strings');
  }

  const command = parsed[0];
  if (command === undefined) {
    throw new Error('ENVLT_TEST_USE_COMMAND first item must exist');
  }

  return [command, ...parsed.slice(1)];
}

async function main(): Promise<void> {
  const projectRoot = process.env['ENVLT_TEST_USE_PROJECT_ROOT'];
  if (projectRoot === undefined || projectRoot.trim() === '') {
    throw new Error('Missing ENVLT_TEST_USE_PROJECT_ROOT');
  }

  const command = parseCommand(process.env['ENVLT_TEST_USE_COMMAND']);
  const code = await runUse(command, {
    env: 'test',
    projectRoot,
    ...(process.env['ENVLT_TEST_USE_PASSTHROUGH'] === '1' ? { passthrough: true } : {}),
    ...(process.env['ENVLT_TEST_USE_STRICT_SHARED'] === '1' ? { strictShared: true } : {}),
  });

  process.exitCode = code;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown run-use test runner error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
