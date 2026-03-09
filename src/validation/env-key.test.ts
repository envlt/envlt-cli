import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateEnvVarKey } from './env-key.js';

void describe('validation/env-key', () => {
  void it('does return ok for arbitrary key while validator is a stub', () => {
    const result = validateEnvVarKey('ANY_VALUE');

    assert.equal(result.ok, true);
  });
});
