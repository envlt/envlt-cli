import chalk from 'chalk';

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

type LoggerOptions = {
  readonly quiet?: boolean;
  readonly noColor?: boolean;
};

const COLOR_LEVELS: Readonly<Record<Exclude<LogLevel, 'info'>, (value: string) => string>> = {
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.gray,
};

function shouldDisableColor(options: LoggerOptions | undefined): boolean {
  if (options?.noColor !== undefined) {
    return options.noColor;
  }

  return process.env['NO_COLOR'] !== undefined || !process.stdout.isTTY;
}

function formatMessage(level: LogLevel, message: string, disableColor: boolean): string {
  if (disableColor || level === 'info') {
    return message;
  }

  return COLOR_LEVELS[level](message);
}

export function createLogger(options?: LoggerOptions): Logger {
  const quiet = options?.quiet ?? false;
  const disableColor = shouldDisableColor(options);

  return {
    info(message: string): void {
      if (!quiet) {
        process.stdout.write(`${formatMessage('info', message, disableColor)}\n`);
      }
    },
    success(message: string): void {
      if (!quiet) {
        process.stdout.write(`${formatMessage('success', message, disableColor)}\n`);
      }
    },
    warn(message: string): void {
      process.stdout.write(`${formatMessage('warn', message, disableColor)}\n`);
    },
    error(message: string): void {
      process.stderr.write(`${formatMessage('error', message, disableColor)}\n`);
    },
    debug(message: string): void {
      if (!quiet) {
        process.stdout.write(`${formatMessage('debug', message, disableColor)}\n`);
      }
    },
  };
}

export const logger = createLogger();
