import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ALGORITHM, AUTH_TAG_BYTES, IV_BYTES, KEY_BYTES } from './constants.js';
import { AppError, ErrorCode } from './errors.js';

const KEY_HEX_LENGTH = KEY_BYTES * 2;
const HEX_REGEX = /^[0-9a-fA-F]+$/;

function parseAndValidateKey(keyHex: string): Buffer {
  if (keyHex.length !== KEY_HEX_LENGTH || !HEX_REGEX.test(keyHex)) {
    throw new AppError(ErrorCode.CRYPTO_INVALID_KEY, 'Key must be 64 hex characters.');
  }

  return Buffer.from(keyHex, 'hex');
}

export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}

export function encrypt(plaintext: string, keyHex: string): string {
  const key = parseAndValidateKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(ciphertext: string, keyHex: string): string {
  const key = parseAndValidateKey(keyHex);

  try {
    const combined = Buffer.from(ciphertext, 'base64');
    const minimumLength = IV_BYTES + AUTH_TAG_BYTES;
    if (combined.length < minimumLength) {
      throw new AppError(
        ErrorCode.CRYPTO_DECRYPT_FAILED,
        'Ciphertext is malformed or authentication failed.',
      );
    }

    const iv = combined.subarray(0, IV_BYTES);
    const authTag = combined.subarray(IV_BYTES, minimumLength);
    const encryptedPayload = combined.subarray(minimumLength);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]).toString(
      'utf8',
    );

    return plaintext;
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === ErrorCode.CRYPTO_INVALID_KEY) {
      throw error;
    }

    throw new AppError(
      ErrorCode.CRYPTO_DECRYPT_FAILED,
      'Ciphertext is malformed or authentication failed.',
      error,
    );
  }
}
