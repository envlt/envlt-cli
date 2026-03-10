import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ensureIntegrationBuild } from './build.js';

const DIST_BIN_PATH = path.resolve('dist/bin/envlt.js');

let projectRoot = '';
let tempHome = '';

function quoteEditorArg(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function buildEditorCommand(scriptPath: string): string {
  return `${quoteEditorArg(process.execPath)} ${quoteEditorArg(scriptPath)}`;
}

async function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DIST_BIN_PATH, ...args], { cwd: projectRoot, env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

beforeEach(async () => {
  await ensureIntegrationBuild();

  projectRoot = path.join(os.tmpdir(), randomUUID());
  tempHome = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(tempHome, { recursive: true });

  const configText = JSON.stringify(
    { appName: 'envlt-e2e', envs: ['test'], keyId: 'main' },
    null,
    2,
  );
  await fs.writeFile(path.join(projectRoot, 'envlt.config.json'), `${configText}\n`, 'utf8');

  const keysDir = path.join(tempHome, '.envlt', 'keys');
  await fs.mkdir(keysDir, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(tempHome, '.envlt'), 0o700);
  await fs.chmod(keysDir, 0o700);
  await fs.writeFile(path.join(keysDir, 'main'), 'f'.repeat(64), { mode: 0o600 });
  await fs.chmod(path.join(keysDir, 'main'), 0o600);
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
});

void describe('integration/edit', () => {
  void it('does edit env and leave no temp edit files behind', async () => {
    const editorScriptPath = path.join(projectRoot, 'editor-script.js');
    const capturedTmpPathFile = path.join(projectRoot, 'captured-tmp-path.txt');
    const editorScript = [
      "import * as fs from 'node:fs';",
      'const target = process.argv[2];',
      "const capturePath = process.env['ENVLT_CAPTURE_TMP_PATH'];",
      "if (capturePath !== undefined) fs.writeFileSync(capturePath, target, 'utf8');",
      "fs.writeFileSync(target, 'FOO=edited\\n', 'utf8');",
    ].join('\n');
    await fs.writeFile(editorScriptPath, editorScript, 'utf8');

    const editorCommand = buildEditorCommand(editorScriptPath);
    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      EDITOR: editorCommand,
      ENVLT_CAPTURE_TMP_PATH: capturedTmpPathFile,
    };

    const setResult = await runCli(['set', 'FOO=original', '--env', 'test'], baseEnv);
    assert.equal(setResult.code, 0);

    const editResult = await runCli(['edit', '--env', 'test'], baseEnv);
    assert.equal(editResult.code, 0);

    const useResult = await runCli(
      [
        'use',
        '--env',
        'test',
        '--',
        process.execPath,
        '-e',
        "process.stdout.write(process.env['FOO'] ?? '')",
      ],
      baseEnv,
    );
    assert.equal(useResult.code, 0);
    assert.equal(useResult.stdout, 'edited');

    const capturedTmpPath = await fs.readFile(capturedTmpPathFile, 'utf8');
    await assert.rejects(fs.access(capturedTmpPath));
  });
});
