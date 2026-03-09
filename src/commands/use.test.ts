import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { EXIT_CODES } from '../constants.js';
import { writeConfig, type EnvltConfig } from '../config.js';
import { writeEncEnv } from '../envfile.js';
import { saveKey } from '../keystore.js';
import { createFilesystemAdapter } from '../storage/index.js';

let projectRoot = '';
let tempHome = '';
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
const repoRoot = path.resolve('.');
const useModuleUrl = pathToFileURL(path.resolve('src/commands/use.ts')).href;
const nodeExec = process.execPath;

type RunNodeResult = {
  readonly code: number;
  readonly stdout: string;
};

function createRunUseScript(commandItems: readonly string[], passthrough?: boolean): string {
  const commandLiteral = JSON.stringify(commandItems);
  const projectRootLiteral = JSON.stringify(projectRoot);
  const passthroughFragment = passthrough === true ? ', passthrough: true' : '';
  return `(async () => { const { runUse } = await import('${useModuleUrl}'); const code = await runUse(${commandLiteral}, { env: 'test', projectRoot: ${projectRootLiteral}${passthroughFragment} }); process.exit(code); })();`;
}

function runNode(script: string, env: NodeJS.ProcessEnv): Promise<RunNodeResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', script], {
      env,
      cwd: repoRoot,
    });
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout });
    });
  });
}

async function setupFixture(): Promise<void> {
  const key = 'f'.repeat(64);
  const config: EnvltConfig = {
    appName: 'envlt',
    envs: ['test'],
    keyId: 'main',
  };

  const adapter = createFilesystemAdapter(projectRoot);
  const writeConfigResult = await writeConfig(config, projectRoot, adapter);
  if (!writeConfigResult.ok) {
    throw writeConfigResult.error;
  }

  const saveKeyResult = await saveKey('main', key);
  if (!saveKeyResult.ok) {
    throw saveKeyResult.error;
  }

  const writeEnvResult = await writeEncEnv('test', { FOO: 'bar' }, key, projectRoot, adapter);
  if (!writeEnvResult.ok) {
    throw writeEnvResult.error;
  }
}

beforeEach(async () => {
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }

  if (originalUserProfile === undefined) {
    delete process.env['USERPROFILE'];
  } else {
    process.env['USERPROFILE'] = originalUserProfile;
  }

  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('commands/use', () => {
  void it('does spawn the command with decrypted vars in environment', async () => {
    await setupFixture();
    const script = createRunUseScript([
      nodeExec,
      '-e',
      "process.stdout.write(process.env.FOO ?? '')",
    ]);

    const result = await runNode(script, { ...process.env, HOME: tempHome, USERPROFILE: tempHome });
    assert.equal(result.code, EXIT_CODES.SUCCESS);
    assert.equal(result.stdout, 'bar');
  });

  void it('does not pass parent env vars unless passthrough is true', async () => {
    await setupFixture();
    const script = createRunUseScript([
      nodeExec,
      '-e',
      "process.stdout.write(process.env.PARENT_ONLY ?? '')",
    ]);

    const result = await runNode(script, {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      PARENT_ONLY: 'hidden',
    });
    assert.equal(result.code, EXIT_CODES.SUCCESS);
    assert.equal(result.stdout, '');
  });

  void it('does include parent env vars when passthrough is true', async () => {
    await setupFixture();
    const script = createRunUseScript(
      [
        nodeExec,
        '-e',
        "process.stdout.write((process.env.PARENT_ONLY ?? '') + ':' + (process.env.FOO ?? ''))",
      ],
      true,
    );

    const result = await runNode(script, {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      PARENT_ONLY: 'seen',
    });
    assert.equal(result.stdout, 'seen:bar');
  });

  void it('does let decrypted vars override parent vars in passthrough mode', async () => {
    await setupFixture();
    const script = createRunUseScript(
      [nodeExec, '-e', "process.stdout.write(process.env.FOO ?? '')"],
      true,
    );

    const result = await runNode(script, {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      FOO: 'parent',
    });
    assert.equal(result.stdout, 'bar');
  });

  void it('does exit with child exit code', async () => {
    await setupFixture();
    const script = createRunUseScript([nodeExec, '-e', 'process.exit(7)']);

    const result = await runNode(script, { ...process.env, HOME: tempHome, USERPROFILE: tempHome });
    assert.equal(result.code, 7);
  });

  void it('does exit with MISSING_CONFIG when config file is missing', async () => {
    const script = createRunUseScript([nodeExec, '-e', 'process.exit(0)']);

    const result = await runNode(script, { ...process.env, HOME: tempHome, USERPROFILE: tempHome });
    assert.equal(result.code, EXIT_CODES.MISSING_CONFIG);
  });

  void it('does exit with DECRYPTION_FAILED when key cannot be loaded', async () => {
    const adapter = createFilesystemAdapter(projectRoot);
    const config: EnvltConfig = { appName: 'envlt', envs: ['test'], keyId: 'missing-key' };
    const configResult = await writeConfig(config, projectRoot, adapter);
    if (!configResult.ok) {
      throw configResult.error;
    }

    const script = createRunUseScript([nodeExec, '-e', 'process.exit(0)']);
    const result = await runNode(script, {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    });
    assert.equal(result.code, EXIT_CODES.DECRYPTION_FAILED);
  });

  void it('does exit with DECRYPTION_FAILED when env file is missing', async () => {
    const key = 'f'.repeat(64);
    const adapter = createFilesystemAdapter(projectRoot);
    const config: EnvltConfig = { appName: 'envlt', envs: ['test'], keyId: 'main' };
    const configResult = await writeConfig(config, projectRoot, adapter);
    if (!configResult.ok) {
      throw configResult.error;
    }

    const saveKeyResult = await saveKey('main', key);
    if (!saveKeyResult.ok) {
      throw saveKeyResult.error;
    }

    const script = createRunUseScript([nodeExec, '-e', 'process.exit(0)']);
    const result = await runNode(script, { ...process.env, HOME: tempHome, USERPROFILE: tempHome });
    assert.equal(result.code, EXIT_CODES.DECRYPTION_FAILED);
  });

  void it('does exit with CHILD_PROCESS_ERROR when command is not found', async () => {
    await setupFixture();
    const script = createRunUseScript(['__missing_command__']);

    const result = await runNode(script, { ...process.env, HOME: tempHome, USERPROFILE: tempHome });
    assert.equal(result.code, EXIT_CODES.CHILD_PROCESS_ERROR);
  });
});
