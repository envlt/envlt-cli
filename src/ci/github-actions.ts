import { ok, type Result } from '../result.js';
import type { StorageAdapter } from '../storage/index.js';

export function generateGithubActionsWorkflow(
  envs: readonly string[],
  projectRoot: string,
  adapter: StorageAdapter,
): Promise<Result<void>> {
  void envs;
  void projectRoot;
  void adapter;
  return Promise.resolve(ok(undefined));
}
