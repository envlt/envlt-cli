import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { levenshteinDistance } from './levenshtein.js';

void describe('validation/levenshtein', () => {
  void it('does return expected distances for required examples', () => {
    assert.equal(levenshteinDistance('', ''), 0);
    assert.equal(levenshteinDistance('abc', ''), 3);
    assert.equal(levenshteinDistance('', 'abc'), 3);
    assert.equal(levenshteinDistance('abc', 'abc'), 0);
    assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
    assert.equal(levenshteinDistance('DATABASE_URL', 'DATBASE_URL'), 1);
    assert.equal(levenshteinDistance('STRIPE_PUBLIC_KEY', 'STRIPE_PUBLIK_KEY'), 1);
  });

  void it('does satisfy symmetry for several pairs', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['DATABASE_URL', 'DATBASE_URL'],
      ['SMTP_PASSWORD', 'SMTP_PASSWRD'],
      ['NODE_ENV', 'NODE_ENVIRONMENT'],
      ['A', 'B'],
    ];

    for (const [a, b] of pairs) {
      assert.equal(levenshteinDistance(a, b), levenshteinDistance(b, a));
    }
  });

  void it('does satisfy triangle inequality for several triples', () => {
    const triples: readonly (readonly [string, string, string])[] = [
      ['kitten', 'sitting', 'smitten'],
      ['DATABASE_URL', 'DATBASE_URL', 'DATBASE_UR'],
      ['STRIPE_PUBLIC_KEY', 'STRIPE_PUBLIK_KEY', 'STRIPE_PUBLIK_KE'],
    ];

    for (const [a, b, c] of triples) {
      const left = levenshteinDistance(a, c);
      const right = levenshteinDistance(a, b) + levenshteinDistance(b, c);
      assert.ok(left <= right);
    }
  });
});
