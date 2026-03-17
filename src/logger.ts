import chalk from 'chalk';

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export type LoggerOptions = {
  readonly quiet?: boolean;
  readonly noColor?: boolean;
  readonly verbose?: boolean;
};

const COLOR_LEVELS: Readonly<Record<Exclude<LogLevel, 'info'>, (value: string) => string>> = {
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray,
};

function shouldDisableColor(options: LoggerOptions | undefined, isTty: boolean): boolean {
  if (options?.noColor !== undefined) {
    return options.noColor;
  }

  return process.env['NO_COLOR'] !== undefined || !isTty;
}

function formatMessage(level: LogLevel, message: string, disableColor: boolean): string {
  if (disableColor || level === 'info') {
    return message;
  }

  return COLOR_LEVELS[level](message);
}

export function createLogger(options?: LoggerOptions): Logger {
  const quiet = options?.quiet ?? false;
  const verbose = options?.verbose ?? false;

  return {
    info(message: string): void {
      if (!quiet) {
        const disableColor = shouldDisableColor(options, process.stdout.isTTY);
        process.stdout.write(`${formatMessage('info', message, disableColor)}\n`);
      }
    },
    success(message: string): void {
      if (!quiet) {
        const disableColor = shouldDisableColor(options, process.stdout.isTTY);
        process.stdout.write(`${formatMessage('success', message, disableColor)}\n`);
      }
    },
    warn(message: string): void {
      const disableColor = shouldDisableColor(options, process.stderr.isTTY);
      process.stderr.write(`${formatMessage('warn', message, disableColor)}\n`);
    },
    error(message: string): void {
      const disableColor = shouldDisableColor(options, process.stderr.isTTY);
      process.stderr.write(`${formatMessage('error', message, disableColor)}\n`);
    },
    debug(message: string): void {
      if (!quiet && verbose) {
        const disableColor = shouldDisableColor(options, process.stdout.isTTY);
        process.stdout.write(`${formatMessage('debug', message, disableColor)}\n`);
      }
    },
  };
}

let _instance = createLogger();

export function configure(opts: LoggerOptions): void {
  _instance = createLogger(opts);
}

export const logger: Logger = {
  info: (msg) => {
    _instance.info(msg);
  },
  success: (msg) => {
    _instance.success(msg);
  },
  warn: (msg) => {
    _instance.warn(msg);
  },
  error: (msg) => {
    _instance.error(msg);
  },
  debug: (msg) => {
    _instance.debug(msg);
  },
};
