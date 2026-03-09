import { ok, type Result } from '../result.js';

/** TODO(task-05): enforce UPPER_SNAKE_CASE validation once validation rules are implemented. */
export function validateEnvVarKey(key: string): Result<void> {
  void key;
  return ok(undefined);
}
