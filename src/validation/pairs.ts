import type { EnvVars } from '../envfile.js';

export type PairViolation = {
  readonly presentKey: string;
  readonly missingKey: string;
};

export function checkRequiredPairs(
  vars: EnvVars,
  pairs: readonly [string, string][],
): readonly PairViolation[] {
  return pairs.flatMap(([firstKey, secondKey]) => {
    const firstPresent = vars[firstKey] !== undefined;
    const secondPresent = vars[secondKey] !== undefined;

    if (firstPresent && !secondPresent) {
      return [{ presentKey: firstKey, missingKey: secondKey }];
    }

    if (secondPresent && !firstPresent) {
      return [{ presentKey: secondKey, missingKey: firstKey }];
    }

    return [];
  });
}
