import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ErrorCode } from '../errors.js';

import { parseExtendsEntry } from './types.js';

void describe('shared/types', () => {
  void it('does parse github extends entry with nested path', () => {
    const result = parseExtendsEntry('github:my-org/secrets/shared/stripe');
    if (!result.ok) {
      assert.fail(result.error.message);
    }

    assert.deepEqual(result.value, {
      type: 'github',
      org: 'my-org',
      repo: 'secrets',
      path: 'shared/stripe',
    });
  });

  void it('does parse deep nested github path', () => {
    const result = parseExtendsEntry('github:org/repo/deep/nested/path');
    if (!result.ok) {
      assert.fail(result.error.message);
    }

    assert.equal(result.value.path, 'deep/nested/path');
  });

  void it('does return CONFIG_INVALID for unsupported type', () => {
    const result = parseExtendsEntry('s3:bucket/path');
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID for missing repo and path', () => {
    const result = parseExtendsEntry('github:org');
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });

  void it('does return CONFIG_INVALID for empty string', () => {
    const result = parseExtendsEntry('');
    if (result.ok) {
      assert.fail('Expected error result');
    }

    assert.equal(result.error.code, ErrorCode.CONFIG_INVALID);
  });
});
