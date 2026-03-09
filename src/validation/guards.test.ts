import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isObjectRecord } from './guards.js';

void describe('validation/guards', () => {
  void it('does return true for plain objects', () => {
    assert.equal(isObjectRecord({ key: 'value' }), true);
  });

  void it('does return false for null', () => {
    assert.equal(isObjectRecord(null), false);
  });

  void it('does return false for arrays', () => {
    assert.equal(isObjectRecord(['a']), false);
  });

  void it('does return false for primitive values', () => {
    assert.equal(isObjectRecord('value'), false);
    assert.equal(isObjectRecord(1), false);
    assert.equal(isObjectRecord(true), false);
  });
});
