export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const AUTH_TAG_BYTES = 16;
export const ALGORITHM = 'aes-256-gcm' as const;

export const ENV_NAME_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;
export const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export const CONFIG_FILE_NAME = 'envlt.config.json';
export const DEFAULT_ENV = 'development';
export const APP_NAME_MAX_LENGTH = 64;
export const LOCAL_KEYS_DIR = '.envlt/keys';

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  MISSING_CONFIG: 2,
  DECRYPTION_FAILED: 3,
  CHILD_PROCESS_ERROR: 4,
  CHECK_FAILED: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const GITIGNORE_ADDITIONS = `
# envlt
.env.local
*.enc.env.tmp
.envlt/
` as const;
