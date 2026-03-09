import * as assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createLogger } from './logger.js';

type WriteCall = readonly [string | Uint8Array];

let stdoutWriteCalls: WriteCall[] = [];
let stderrWriteCalls: WriteCall[] = [];
let stdoutRestore: () => void;
let stderrRestore: () => void;
let originalNoColor: string | undefined;
let originalForceColor: string | undefined;

function setIsTty(stream: NodeJS.WriteStream, value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', {
    configurable: true,
    value,
  });

  return (): void => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(stream, 'isTTY');
      return;
    }

    Object.defineProperty(stream, 'isTTY', descriptor);
  };
}

beforeEach(() => {
  stdoutWriteCalls = [];
  stderrWriteCalls = [];
  originalNoColor = process.env['NO_COLOR'];
  originalForceColor = process.env['FORCE_COLOR'];

  const stdoutMock = mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
    stdoutWriteCalls.push([chunk]);
    return true;
  });
  const stderrMock = mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => {
    stderrWriteCalls.push([chunk]);
    return true;
  });

  stdoutRestore = (): void => {
    stdoutMock.mock.restore();
  };
  stderrRestore = (): void => {
    stderrMock.mock.restore();
  };
});

afterEach(() => {
  stdoutRestore();
  stderrRestore();

  if (originalNoColor === undefined) {
    delete process.env['NO_COLOR'];
  } else {
    process.env['NO_COLOR'] = originalNoColor;
  }

  if (originalForceColor === undefined) {
    delete process.env['FORCE_COLOR'];
  } else {
    process.env['FORCE_COLOR'] = originalForceColor;
  }
});

void describe('logger', () => {
  void it('does suppress info/success/debug when quiet is true', () => {
    const logger = createLogger({ quiet: true, noColor: true });

    logger.info('a');
    logger.success('b');
    logger.debug('c');

    assert.equal(stdoutWriteCalls.length, 0);
  });

  void it('does always write warn and error to stderr', () => {
    const logger = createLogger({ quiet: true, noColor: true });

    logger.warn('warn');
    logger.error('error');

    assert.deepEqual(stderrWriteCalls, [['warn\n'], ['error\n']]);
    assert.equal(stdoutWriteCalls.length, 0);
  });

  void it('does disable color when NO_COLOR is set', () => {
    process.env['NO_COLOR'] = '1';
    const restoreStdoutTty = setIsTty(process.stdout, true);
    const logger = createLogger();

    logger.success('ok');

    restoreStdoutTty();
    assert.deepEqual(stdoutWriteCalls, [['ok\n']]);
  });

  void it('does use stderr tty state for color decisions', () => {
    process.env['FORCE_COLOR'] = '1';
    const restoreStdoutTty = setIsTty(process.stdout, true);
    const restoreStderrTty = setIsTty(process.stderr, false);
    const logger = createLogger();

    logger.warn('boom');

    restoreStdoutTty();
    restoreStderrTty();
    assert.equal(stderrWriteCalls[0]?.[0], 'boom\n');
  });

  void it('does write normal levels to stdout when quiet is false', () => {
    const logger = createLogger({ noColor: true });

    logger.info('info');
    logger.success('success');
    logger.debug('debug');

    assert.deepEqual(stdoutWriteCalls, [['info\n'], ['success\n'], ['debug\n']]);
  });
});
