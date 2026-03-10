import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError, ErrorCode } from '../errors.js';
import type { Result } from '../result.js';

import { parseAssignment, validateKey } from './keys.js';

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    assert.fail(`Expected ok result, got error: ${result.error.message}`);
  }

  return result.value;
}

void describe('validation/keys', () => {
  void it('does validate known keys without warnings', () => {
    assert.deepEqual(validateKey('DATABASE_URL'), { valid: true, warnings: [] });
    assert.deepEqual(validateKey('PORT'), { valid: true, warnings: [] });
  });

  void it('does reject lowercase keys', () => {
    assert.equal(validateKey('database_url').valid, false);
  });

  void it('does reject keys starting with digit', () => {
    assert.equal(validateKey('1INVALID').valid, false);
  });

  void it('does reject keys starting with underscore', () => {
    assert.equal(validateKey('_INVALID').valid, false);
  });

  void it('does reject keys ending with underscore', () => {
    assert.equal(validateKey('INVALID_').valid, false);
  });

  void it('does reject keys with consecutive underscores', () => {
    assert.equal(validateKey('DOUBLE__UNDERSCORE').valid, false);
  });

  void it('does reject keys exceeding max length', () => {
    assert.equal(validateKey('A'.repeat(129)).valid, false);
  });

  void it('does warn for close typo against built-in dictionary', () => {
    assert.deepEqual(validateKey('DATBASE_URL'), {
      valid: true,
      warnings: ['Suspicious key "DATBASE_URL". Did you mean DATABASE_URL?'],
    });

    assert.deepEqual(validateKey('STRIPE_PUBLIK_KEY'), {
      valid: true,
      warnings: ['Suspicious key "STRIPE_PUBLIK_KEY". Did you mean STRIPE_PUBLIC_KEY?'],
    });
  });

  void it('does handle custom dictionary for exact and typo matches', () => {
    assert.deepEqual(validateKey('MY_CUSTOM_VAR', ['MY_CUSTOM_VAR']), {
      valid: true,
      warnings: [],
    });
    assert.deepEqual(validateKey('MY_CUSTM_VAR', ['MY_CUSTOM_VAR']), {
      valid: true,
      warnings: ['Suspicious key "MY_CUSTM_VAR". Did you mean MY_CUSTOM_VAR?'],
    });
  });

  void it('does ignore invalid custom dictionary entries for suggestions', () => {
    assert.deepEqual(validateKey('MY_CUSTM_VAR', ['my_custom_var', '_BAD', 'MY_CUSTOM_VAR']), {
      valid: true,
      warnings: ['Suspicious key "MY_CUSTM_VAR". Did you mean MY_CUSTOM_VAR?'],
    });
  });

  void it('does not warn when key exists in custom dictionary even if close to built-in key', () => {
    assert.deepEqual(validateKey('STRIPE_PUBLIK_KEY', ['STRIPE_PUBLIK_KEY']), {
      valid: true,
      warnings: [],
    });
  });

  void it('does suggest custom dictionary key for slight typos', () => {
    assert.deepEqual(validateKey('PAYMNETS_TOKEN', ['PAYMENTS_TOKEN']), {
      valid: true,
      warnings: ['Suspicious key "PAYMNETS_TOKEN". Did you mean PAYMENTS_TOKEN?'],
    });
  });

  void it('does parse assignment for simple value', () => {
    assert.deepEqual(expectOk(parseAssignment('FOO=bar')), {
      key: 'FOO',
      value: 'bar',
      warnings: [],
    });
  });

  void it('does parse assignment splitting on first equals only', () => {
    assert.equal(expectOk(parseAssignment('FOO=bar=baz')).value, 'bar=baz');
  });

  void it('does return SET_INVALID_ASSIGNMENT when equals sign is missing', () => {
    const result = parseAssignment('NODEP');
    if (result.ok) {
      assert.fail('Expected parseAssignment to fail for missing equals sign.');
    }

    assert.equal(result.error instanceof AppError, true);
    if (result.error instanceof AppError) {
      assert.equal(result.error.code, ErrorCode.SET_INVALID_ASSIGNMENT);
    }
  });

  void it('does return error for invalid key format', () => {
    const result = parseAssignment('foo=bar');
    if (result.ok) {
      assert.fail('Expected parseAssignment to fail for invalid key.');
    }

    assert.equal(result.error instanceof AppError, true);
  });

  void it('does choose lexicographically smaller suggestion on equal distance', () => {
    assert.deepEqual(validateKey('AAAA', ['AAAC', 'AAAB']), {
      valid: true,
      warnings: ['Suspicious key "AAAA". Did you mean AAAB?'],
    });
  });

  void it('does avoid suggestions when length difference is too large', () => {
    assert.deepEqual(validateKey('VERY_LONG_VARIABLE_NAME', ['X']), { valid: true, warnings: [] });
  });
});
