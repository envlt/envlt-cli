import * as assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { configure, createLogger, logger } from './logger.js';

type WriteCall = readonly [string | Uint8Array];

let stdoutWriteCalls: WriteCall[] = [];
let stderrWriteCalls: WriteCall[] = [];
let stdoutRestore: () => void;
let stderrRestore: () => void;
let originalNoColor: string | undefined;

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

  void it('does write success when tty is true and color path is enabled', () => {
    delete process.env['NO_COLOR'];
    const restoreStdoutTty = setIsTty(process.stdout, true);
    const logger = createLogger();

    logger.success('ok');

    restoreStdoutTty();
    assert.equal(typeof stdoutWriteCalls[0]?.[0], 'string');
  });

  void it('does honor explicit noColor false and write success output', () => {
    const restoreStdoutTty = setIsTty(process.stdout, false);
    const logger = createLogger({ noColor: false });

    logger.success('ok');

    restoreStdoutTty();
    assert.equal(typeof stdoutWriteCalls[0]?.[0], 'string');
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

    assert.deepEqual(stdoutWriteCalls, [['info\n'], ['success\n']]);
  });

  void it('does not write debug by default', () => {
    const logger = createLogger({ noColor: true });
    logger.debug('hidden');
    assert.equal(stdoutWriteCalls.length, 0);
  });

  void it('does write debug when verbose is true', () => {
    const logger = createLogger({ noColor: true, verbose: true });
    logger.debug('visible');
    assert.deepEqual(stdoutWriteCalls, [['visible\n']]);
  });

  void it('does suppress debug even when verbose if quiet is true', () => {
    const logger = createLogger({ quiet: true, verbose: true, noColor: true });
    logger.debug('suppressed');
    assert.equal(stdoutWriteCalls.length, 0);
  });

  void it('does let configure enable singleton debug logging', () => {
    configure({ noColor: true, verbose: true });
    logger.debug('singleton-debug');
    assert.deepEqual(stdoutWriteCalls, [['singleton-debug\n']]);
  });

  void it('does let configure suppress singleton logs in quiet mode', () => {
    configure({ quiet: true, noColor: true, verbose: true });
    logger.info('hidden-info');
    logger.success('hidden-success');
    logger.debug('hidden-debug');
    assert.equal(stdoutWriteCalls.length, 0);
  });

  void it('does keep singleton warn and error on stderr when configured quiet', () => {
    configure({ quiet: true, noColor: true });
    logger.warn('singleton-warn');
    logger.error('singleton-error');
    assert.deepEqual(stderrWriteCalls, [['singleton-warn\n'], ['singleton-error\n']]);
  });
});
