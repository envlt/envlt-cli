import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { decrypt, encrypt, generateKey } from './crypto.js';
import { AppError, ErrorCode } from './errors.js';

function assertAppErrorWithCode(error: unknown, code: ErrorCode): void {
  if (!(error instanceof AppError)) {
    throw new Error('Expected AppError instance.');
  }

  assert.equal(error.code, code);
}

void describe('crypto', () => {
  void it('does return encrypted string different from input when encrypt is called', () => {
    const key = generateKey();
    const plaintext = 'hello world';

    const encrypted = encrypt(plaintext, key);

    assert.notEqual(encrypted, plaintext);
  });

  void it('does round-trip decrypt(encrypt()) for empty string', () => {
    const key = generateKey();
    const plaintext = '';

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    assert.equal(decrypted, plaintext);
  });

  void it('does round-trip decrypt(encrypt()) for unicode string', () => {
    const key = generateKey();
    const plaintext = 'こんにちは🌍 — café — 🚀';

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    assert.equal(decrypted, plaintext);
  });

  void it('does round-trip decrypt(encrypt()) for 10KB string', () => {
    const key = generateKey();
    const plaintext = 'a'.repeat(10 * 1024);

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    assert.equal(decrypted, plaintext);
  });

  void it('does produce different ciphertexts for same plaintext and key due to random IV', () => {
    const key = generateKey();
    const plaintext = 'same input';

    const encryptedOne = encrypt(plaintext, key);
    const encryptedTwo = encrypt(plaintext, key);

    assert.notEqual(encryptedOne, encryptedTwo);
  });

  void it('does throw CRYPTO_DECRYPT_FAILED when decrypting with wrong key', () => {
    const key = generateKey();
    const wrongKey = generateKey();
    const encrypted = encrypt('secret', key);

    assert.throws(
      () => {
        decrypt(encrypted, wrongKey);
      },
      (error: unknown) => {
        assertAppErrorWithCode(error, ErrorCode.CRYPTO_DECRYPT_FAILED);
        return true;
      },
    );
  });

  void it('does throw CRYPTO_DECRYPT_FAILED when ciphertext is tampered', () => {
    const key = generateKey();
    const encrypted = encrypt('secret', key);
    const combined = Buffer.from(encrypted, 'base64');
    const lastByte = combined.at(-1);

    if (lastByte === undefined) {
      throw new Error('Expected encrypted payload to contain at least 1 byte.');
    }

    combined[combined.length - 1] = lastByte ^ 0x01;
    const tampered = combined.toString('base64');

    assert.throws(
      () => {
        decrypt(tampered, key);
      },
      (error: unknown) => {
        assertAppErrorWithCode(error, ErrorCode.CRYPTO_DECRYPT_FAILED);
        return true;
      },
    );
  });

  void it('does throw CRYPTO_DECRYPT_FAILED when decrypting empty string', () => {
    const key = generateKey();

    assert.throws(
      () => {
        decrypt('', key);
      },
      (error: unknown) => {
        assertAppErrorWithCode(error, ErrorCode.CRYPTO_DECRYPT_FAILED);
        return true;
      },
    );
  });

  void it('does throw CRYPTO_DECRYPT_FAILED when decrypting truncated ciphertext', () => {
    const key = generateKey();
    const encrypted = encrypt('secret', key);
    const combined = Buffer.from(encrypted, 'base64');
    const truncated = combined.subarray(0, 10).toString('base64');

    assert.throws(
      () => {
        decrypt(truncated, key);
      },
      (error: unknown) => {
        assertAppErrorWithCode(error, ErrorCode.CRYPTO_DECRYPT_FAILED);
        return true;
      },
    );
  });

  void it('does return a 64-char hex string from generateKey', () => {
    const key = generateKey();

    assert.match(key, /^[0-9a-f]{64}$/i);
    assert.equal(key.length, 64);
  });

  void it('does return distinct keys when generateKey called twice', () => {
    const keyOne = generateKey();
    const keyTwo = generateKey();

    assert.notEqual(keyOne, keyTwo);
  });

  void it('does throw CRYPTO_INVALID_KEY when encrypting with 63-char key', () => {
    const invalidKey = 'a'.repeat(63);

    assert.throws(
      () => {
        encrypt('secret', invalidKey);
      },
      (error: unknown) => {
        assertAppErrorWithCode(error, ErrorCode.CRYPTO_INVALID_KEY);
        return true;
      },
    );
  });

  void it('does throw CRYPTO_INVALID_KEY when decrypting with non-hex key', () => {
    const invalidKey = 'z'.repeat(64);

    assert.throws(
      () => {
        decrypt('abcd', invalidKey);
      },
      (error: unknown) => {
        assertAppErrorWithCode(error, ErrorCode.CRYPTO_INVALID_KEY);
        return true;
      },
    );
  });
});
