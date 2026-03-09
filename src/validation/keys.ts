import { AppError, ErrorCode } from '../errors.js';
import { err, ok, type Result } from '../result.js';

import { KNOWN_KEYS } from './dictionary.js';
import { levenshteinDistance } from './levenshtein.js';

export type KeyValidationResult =
  | { readonly valid: true; readonly warnings: readonly string[] }
  | { readonly valid: false; readonly error: string };

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const MAX_KEY_LENGTH = 128;
const DOUBLE_UNDERSCORE = '__';
const MAX_SUGGESTION_DISTANCE = 2;
const MAX_SUGGESTION_LENGTH_DELTA = 3;
const ASSIGNMENT_SEPARATOR = '=';

function suggestionMessage(suggestion: string): string {
  return `Did you mean ${suggestion}?`;
}

function invalidKey(message: string): KeyValidationResult {
  return { valid: false, error: message };
}

function findSuggestion(key: string, dictionary: readonly string[]): string | undefined {
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestMatch: string | undefined;

  for (const knownKey of dictionary) {
    if (Math.abs(knownKey.length - key.length) > MAX_SUGGESTION_LENGTH_DELTA) {
      continue;
    }

    const distance = levenshteinDistance(key, knownKey);
    if (distance > MAX_SUGGESTION_DISTANCE || distance > closestDistance) {
      continue;
    }

    if (distance < closestDistance || (closestMatch !== undefined && knownKey < closestMatch)) {
      closestDistance = distance;
      closestMatch = knownKey;
    }
  }

  return closestMatch;
}

function mergedDictionary(customDictionary: readonly string[] | undefined): readonly string[] {
  return customDictionary === undefined
    ? KNOWN_KEYS
    : [...new Set([...KNOWN_KEYS, ...customDictionary])];
}

/**
 * Validate an environment variable key name.
 */
export function validateKey(
  key: string,
  customDictionary?: readonly string[],
): KeyValidationResult {
  if (key.length > MAX_KEY_LENGTH) {
    return invalidKey(`Invalid key "${key}". Key length must be <= ${String(MAX_KEY_LENGTH)}.`);
  }

  if (!KEY_PATTERN.test(key)) {
    return invalidKey(`Invalid key "${key}". Expected UPPER_SNAKE_CASE format.`);
  }

  if (key.startsWith('_') || key.endsWith('_')) {
    return invalidKey(`Invalid key "${key}". Key must not start or end with underscore.`);
  }

  if (key.includes(DOUBLE_UNDERSCORE)) {
    return invalidKey(`Invalid key "${key}". Key must not contain consecutive underscores.`);
  }

  const dictionary = mergedDictionary(customDictionary);
  if (dictionary.includes(key)) {
    return { valid: true, warnings: [] };
  }

  const suggestion = findSuggestion(key, dictionary);
  if (suggestion === undefined) {
    return { valid: true, warnings: [] };
  }

  return { valid: true, warnings: [suggestionMessage(suggestion)] };
}

/**
 * Parse a "KEY=VALUE" assignment string.
 */
export function parseAssignment(
  assignment: string,
  customDictionary?: readonly string[],
): Result<{ readonly key: string; readonly value: string; readonly warnings: readonly string[] }> {
  const separatorIndex = assignment.indexOf(ASSIGNMENT_SEPARATOR);
  if (separatorIndex < 0) {
    return err(
      new AppError(
        ErrorCode.SET_INVALID_ASSIGNMENT,
        `Invalid assignment "${assignment}". Expected KEY=VALUE format.`,
      ),
    );
  }

  const key = assignment.slice(0, separatorIndex);
  const value = assignment.slice(separatorIndex + 1);
  const validationResult = validateKey(key, customDictionary);
  if (!validationResult.valid) {
    return err(new AppError(ErrorCode.SET_INVALID_ASSIGNMENT, validationResult.error));
  }

  return ok({ key, value, warnings: validationResult.warnings });
}
