import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkRequiredPairs } from './pairs.js';

void describe('validation/pairs', () => {
  void it('does return no violations when both keys are present', () => {
    const result = checkRequiredPairs(
      { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PUBLIC_KEY: 'pk_test' },
      [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']],
    );

    assert.deepEqual(result, []);
  });

  void it('does return no violations when neither key is present', () => {
    const result = checkRequiredPairs({ DATABASE_URL: 'postgres://db' }, [
      ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY'],
    ]);

    assert.deepEqual(result, []);
  });

  void it('does return violation when key A is present and key B is absent', () => {
    const result = checkRequiredPairs({ STRIPE_SECRET_KEY: 'sk_test' }, [
      ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY'],
    ]);

    assert.deepEqual(result, [
      { presentKey: 'STRIPE_SECRET_KEY', missingKey: 'STRIPE_PUBLIC_KEY' },
    ]);
  });

  void it('does return violation when key B is present and key A is absent', () => {
    const result = checkRequiredPairs({ STRIPE_PUBLIC_KEY: 'pk_test' }, [
      ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY'],
    ]);

    assert.deepEqual(result, [
      { presentKey: 'STRIPE_PUBLIC_KEY', missingKey: 'STRIPE_SECRET_KEY' },
    ]);
  });

  void it('does evaluate multiple pairs independently', () => {
    const result = checkRequiredPairs(
      {
        STRIPE_SECRET_KEY: 'sk_test',
        AWS_ACCESS_KEY_ID: 'access',
      },
      [
        ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY'],
        ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
      ],
    );

    assert.deepEqual(result, [
      { presentKey: 'STRIPE_SECRET_KEY', missingKey: 'STRIPE_PUBLIC_KEY' },
      { presentKey: 'AWS_ACCESS_KEY_ID', missingKey: 'AWS_SECRET_ACCESS_KEY' },
    ]);
  });

  void it('does return no violations for empty pairs array', () => {
    const result = checkRequiredPairs({ STRIPE_SECRET_KEY: 'sk_test' }, []);
    assert.deepEqual(result, []);
  });

  void it('does return no violations for empty vars', () => {
    const result = checkRequiredPairs({}, [['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY']]);
    assert.deepEqual(result, []);
  });
});
