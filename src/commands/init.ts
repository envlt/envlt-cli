import * as path from 'node:path';

import inquirer from 'inquirer';

import { generateGithubActionsWorkflow } from '../ci/github-actions.js';
import { writeConfig } from '../config.js';
import { CONFIG_FILE_NAME, ENV_NAME_PATTERN, GITIGNORE_ADDITIONS } from '../constants.js';
import { generateKey } from '../crypto.js';
import { parseEnv, writeEncEnv, type EnvVars } from '../envfile.js';
import { AppError, ErrorCode } from '../errors.js';
import { loadKey, saveKey } from '../keystore.js';
import { logger } from '../logger.js';
import { err, ok, type Result } from '../result.js';
import { createFilesystemAdapter, type StorageAdapter } from '../storage/index.js';

const APP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/u;
const APP_NAME_MAX_LENGTH = 64;
const DEFAULT_ENVS = ['development', 'staging', 'production'] as const;
const KEY_ID_SUFFIX_LENGTH = 8;

type InitDependencies = {
  readonly prompter: Prompter;
  readonly createAdapter: (projectRoot: string) => StorageAdapter;
  readonly keyGenerator: () => string;
  readonly now: () => number;
  readonly saveGeneratedKey: (keyId: string, key: string) => Promise<Result<void>>;
  readonly writeStdout: (message: string) => void;
};

export interface InitOptions {
  readonly projectRoot: string;
  readonly force?: boolean;
  readonly skipImport?: boolean;
}

export interface Prompter {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  input(
    message: string,
    defaultValue?: string,
    validate?: (value: string) => string | true,
  ): Promise<string>;
  checkbox(message: string, choices: readonly string[]): Promise<readonly string[]>;
}

const DEFAULT_DEPENDENCIES: InitDependencies = {
  prompter: {
    async confirm(message: string, defaultValue: boolean = false): Promise<boolean> {
      const answer = await inquirer.prompt<{ readonly value: boolean }>([
        { type: 'confirm', name: 'value', message, default: defaultValue },
      ]);
      return answer.value;
    },
    async input(
      message: string,
      defaultValue?: string,
      validate?: (value: string) => string | true,
    ): Promise<string> {
      const answer = await inquirer.prompt<{ readonly value: string }>([
        { type: 'input', name: 'value', message, default: defaultValue, validate },
      ]);
      return answer.value;
    },
    async checkbox(message: string, choices: readonly string[]): Promise<readonly string[]> {
      const answer = await inquirer.prompt<{ readonly value: readonly string[] }>([
        { type: 'checkbox', name: 'value', message, choices, default: choices },
      ]);
      return answer.value;
    },
  },
  createAdapter: createFilesystemAdapter,
  keyGenerator: generateKey,
  now: (): number => Date.now(),
  saveGeneratedKey: saveKey,
  writeStdout: (message: string): void => {
    process.stdout.write(message);
  },
};

function validateAppName(value: string): true | string {
  if (value.trim() === '') {
    return 'App name cannot be empty.';
  }

  if (value.length > APP_NAME_MAX_LENGTH) {
    return `App name must be at most ${String(APP_NAME_MAX_LENGTH)} characters.`;
  }

  return APP_NAME_PATTERN.test(value)
    ? true
    : 'Only letters, numbers, underscores, and dashes are allowed.';
}

function validateEnvName(value: string): true | string {
  return ENV_NAME_PATTERN.test(value) ? true : 'Environment name is invalid.';
}

function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, APP_NAME_MAX_LENGTH);
}

function buildKeyId(appName: string, now: number): string {
  const suffix = String(now).slice(-KEY_ID_SUFFIX_LENGTH);
  const slug = slugifyName(appName) || 'app';
  return `${slug}-${suffix}`;
}

async function chooseEnvs(prompter: Prompter): Promise<readonly string[]> {
  const selected = [...(await prompter.checkbox('Which environments do you need?', DEFAULT_ENVS))];
  const seen = new Set(selected);

  for (;;) {
    const customEnv = (await prompter.input('Add custom env (leave blank to skip):')).trim();
    if (customEnv === '') {
      break;
    }

    const validation = validateEnvName(customEnv);
    if (validation !== true) {
      logger.warn(validation);
      continue;
    }

    if (!seen.has(customEnv)) {
      selected.push(customEnv);
      seen.add(customEnv);
    }
  }

  return selected;
}

async function importLocalEnv(
  envs: readonly string[],
  options: InitOptions,
  adapter: StorageAdapter,
  prompter: Prompter,
): Promise<Result<Readonly<Record<string, EnvVars>>>> {
  const localPath = path.resolve(options.projectRoot, '.env.local');
  const exists = await adapter.exists(localPath);
  if (!exists.ok) {
    return err(exists.error);
  }

  const assignments: Record<string, Record<string, string>> = {};
  for (const env of envs) {
    assignments[env] = {};
  }

  if (!exists.value || options.skipImport === true) {
    return ok(assignments);
  }

  const shouldImport = await prompter.confirm('Found .env.local. Import variables?', true);
  if (!shouldImport) {
    return ok(assignments);
  }

  const readLocal = await adapter.read(localPath);
  if (!readLocal.ok) {
    return err(readLocal.error);
  }

  const parsed = parseEnv(readLocal.value.toString('utf8'));
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const keys = Object.keys(parsed.value);
  if (keys.length === 0) {
    return ok(assignments);
  }

  const selectedKeys = await prompter.checkbox('Select keys to import', keys);
  for (const key of selectedKeys) {
    const targetEnvs = await prompter.checkbox(`Import ${key} to which envs?`, envs);
    for (const env of targetEnvs) {
      const envAssignments = assignments[env];
      if (envAssignments !== undefined) {
        envAssignments[key] = parsed.value[key] ?? '';
      }
    }
  }

  return ok(assignments);
}

async function ensureUniqueKeyId(appName: string, baseNow: number): Promise<Result<string>> {
  let offset = 0;
  while (offset < 1000) {
    const keyId = buildKeyId(appName, baseNow + offset);
    const loadResult = await loadKey(keyId);
    if (!loadResult.ok && loadResult.error.code === ErrorCode.KEYSTORE_KEY_NOT_FOUND) {
      return ok(keyId);
    }

    if (!loadResult.ok && loadResult.error.code !== ErrorCode.KEYSTORE_KEY_NOT_FOUND) {
      return err(loadResult.error);
    }

    offset += 1;
  }

  return err(new AppError(ErrorCode.KEYSTORE_WRITE_ERROR, 'Unable to generate a unique key ID.'));
}

async function writeGitignore(projectRoot: string, adapter: StorageAdapter): Promise<Result<void>> {
  const gitignorePath = path.resolve(projectRoot, '.gitignore');
  const exists = await adapter.exists(gitignorePath);
  if (!exists.ok) {
    return err(exists.error);
  }

  const current = exists.value ? await adapter.read(gitignorePath) : ok(Buffer.from('', 'utf8'));
  if (!current.ok) {
    return err(current.error);
  }

  const lines = current.value.toString('utf8').split(/\r?\n/u);
  const additionLines = GITIGNORE_ADDITIONS.trim().split('\n');
  const missing = additionLines.filter((line) => !lines.includes(line));
  if (missing.length === 0) {
    return ok(undefined);
  }

  const base = current.value.toString('utf8').trimEnd();
  const next = `${base}\n${base === '' ? '' : '\n'}${missing.join('\n')}\n`;
  return adapter.write(gitignorePath, Buffer.from(next, 'utf8'));
}

export async function runInit(
  options: InitOptions,
  dependencies: InitDependencies = DEFAULT_DEPENDENCIES,
): Promise<Result<void>> {
  const adapter = dependencies.createAdapter(options.projectRoot);
  const configPath = path.resolve(options.projectRoot, CONFIG_FILE_NAME);
  const configExists = await adapter.exists(configPath);
  if (!configExists.ok) {
    return err(configExists.error);
  }

  if (configExists.value && options.force !== true) {
    const shouldOverwrite = await dependencies.prompter.confirm(
      'Config already exists. Overwrite?',
      false,
    );
    if (!shouldOverwrite) {
      logger.info('Initialization cancelled.');
      return ok(undefined);
    }
  }

  const defaultAppName = path.basename(path.resolve(options.projectRoot));
  const appName = await dependencies.prompter.input('App name:', defaultAppName, validateAppName);

  const envs = await chooseEnvs(dependencies.prompter);
  if (envs.length === 0) {
    return err(new AppError(ErrorCode.CONFIG_INVALID, 'At least one environment is required.'));
  }

  const imported = await importLocalEnv(envs, options, adapter, dependencies.prompter);
  if (!imported.ok) {
    return err(imported.error);
  }

  const key = dependencies.keyGenerator();
  const keyIdResult = await ensureUniqueKeyId(appName, dependencies.now());
  if (!keyIdResult.ok) {
    return err(keyIdResult.error);
  }

  const saveResult = await dependencies.saveGeneratedKey(keyIdResult.value, key);
  if (!saveResult.ok) {
    return err(saveResult.error);
  }

  for (const envName of envs) {
    const encPath = path.resolve(options.projectRoot, `.env.${envName}.enc`);
    const envExists = await adapter.exists(encPath);
    if (!envExists.ok) {
      return err(envExists.error);
    }

    if (envExists.value) {
      continue;
    }

    const writeResult = await writeEncEnv(
      envName,
      imported.value[envName] ?? {},
      key,
      options.projectRoot,
      adapter,
    );
    if (!writeResult.ok) {
      return err(writeResult.error);
    }
  }

  const configResult = await writeConfig(
    { appName, envs, keyId: keyIdResult.value },
    options.projectRoot,
    adapter,
  );
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const gitignoreResult = await writeGitignore(options.projectRoot, adapter);
  if (!gitignoreResult.ok) {
    return err(gitignoreResult.error);
  }

  const showKey = [
    '─────────────────────────────────────────────────────',
    '  Your master key (SAVE THIS — shown only once):',
    '',
    `  ENVLT_KEY=${key}`,
    '',
    '  Add this to your CI secrets and share securely',
    '  with teammates using a password manager.',
    '─────────────────────────────────────────────────────',
    '',
    `To use in CI, set secret ENVLT_KEY=${key}`,
    '',
  ].join('\n');
  dependencies.writeStdout(showKey);

  const createWorkflow = await dependencies.prompter.confirm(
    'Generate GitHub Actions workflow?',
    true,
  );
  if (createWorkflow) {
    const workflowResult = await generateGithubActionsWorkflow(envs, options.projectRoot, adapter);
    if (!workflowResult.ok) {
      return err(workflowResult.error);
    }
  }

  logger.success('Initialized envlt configuration.');
  logger.info(`App: ${appName}`);
  logger.info(`Environments: ${envs.join(', ')}`);
  logger.info(`Config: ${CONFIG_FILE_NAME}`);
  return ok(undefined);
}
