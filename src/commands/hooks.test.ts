import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { logger } from '../logger.js';

import { runHooksInstall, runHooksStatus, runHooksUninstall } from './hooks.js';

type CapturedLogs = {
  readonly infos: string[];
  readonly successes: string[];
  readonly warnings: string[];
};

let projectRoot = '';
let logs: CapturedLogs;
let originalInfo: typeof logger.info;
let originalSuccess: typeof logger.success;
let originalWarn: typeof logger.warn;

beforeEach(async () => {
  projectRoot = path.join(os.tmpdir(), randomUUID());
  await fs.mkdir(projectRoot, { recursive: true });
  logs = { infos: [], successes: [], warnings: [] };

  originalInfo = logger.info.bind(logger);
  originalSuccess = logger.success.bind(logger);
  originalWarn = logger.warn.bind(logger);

  logger.info = (message: string): void => {
    logs.infos.push(message);
  };
  logger.success = (message: string): void => {
    logs.successes.push(message);
  };
  logger.warn = (message: string): void => {
    logs.warnings.push(message);
  };
});

afterEach(async () => {
  logger.info = originalInfo;
  logger.success = originalSuccess;
  logger.warn = originalWarn;
  await fs.rm(projectRoot, { recursive: true, force: true });
});

void describe('commands/hooks', () => {
  void it('does warn when install runs outside git repo', async () => {
    const result = await runHooksInstall({ projectRoot });
    assert.equal(result.ok, true);
    assert.match(logs.warnings.at(0) ?? '', /No \.git directory found/u);
  });

  void it('does install and report status', async () => {
    await fs.mkdir(path.join(projectRoot, '.git', 'hooks'), { recursive: true });

    const installResult = await runHooksInstall({ projectRoot });
    assert.equal(installResult.ok, true);
    assert.match(logs.successes.at(0) ?? '', /Installed pre-commit hook/u);

    const statusResult = await runHooksStatus({ projectRoot });
    assert.equal(statusResult.ok, true);
    assert.match(logs.infos.at(0) ?? '', /installed/u);
  });

  void it('does warn when hook exists and force is false', async () => {
    await fs.mkdir(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
    await runHooksInstall({ projectRoot });

    const second = await runHooksInstall({ projectRoot });
    assert.equal(second.ok, true);
    assert.match(logs.warnings.at(-1) ?? '', /already exists/u);
  });

  void it('does uninstall and report not installed status', async () => {
    await fs.mkdir(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
    await runHooksInstall({ projectRoot });

    const uninstallResult = await runHooksUninstall({ projectRoot });
    assert.equal(uninstallResult.ok, true);
    assert.match(logs.successes.at(-1) ?? '', /Uninstalled pre-commit hook/u);

    const statusResult = await runHooksStatus({ projectRoot });
    assert.equal(statusResult.ok, true);
    assert.match(logs.infos.at(-1) ?? '', /not installed/u);
  });

  void it('does return error when uninstalling non-envlt hook', async () => {
    await fs.mkdir(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\necho x\n',
      'utf8',
    );

    const result = await runHooksUninstall({ projectRoot });
    assert.equal(result.ok, false);
  });
});
