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
const EMPTY_WARNINGS: readonly string[] = [];

const dictionaryCache = new WeakMap<readonly string[], readonly string[]>();

function suggestionMessage(key: string, suggestion: string): string {
  return `Suspicious key "${key}". Did you mean ${suggestion}?`;
}

function invalidKey(message: string): KeyValidationResult {
  return { valid: false, error: message };
}

function validateKeySyntax(key: string): KeyValidationResult {
  if (key.length > MAX_KEY_LENGTH) {
    return invalidKey(`Invalid key "${key}". Key length must be <= ${String(MAX_KEY_LENGTH)}.`);
  }

  if (!KEY_PATTERN.test(key)) {
    return invalidKey(`Invalid key "${key}". Expected UPPER_SNAKE_CASE format.`);
  }

  if (key.endsWith('_')) {
    return invalidKey(`Invalid key "${key}". Key must not end with underscore.`);
  }

  if (key.includes(DOUBLE_UNDERSCORE)) {
    return invalidKey(`Invalid key "${key}". Key must not contain consecutive underscores.`);
  }

  return { valid: true, warnings: EMPTY_WARNINGS };
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

function toValidDictionaryEntry(entry: string): string | undefined {
  return validateKeySyntax(entry).valid ? entry : undefined;
}

function mergeDictionaries(customDictionary: readonly string[] | undefined): readonly string[] {
  if (customDictionary === undefined) {
    return KNOWN_KEYS;
  }

  const cached = dictionaryCache.get(customDictionary);
  if (cached !== undefined) {
    return cached;
  }

  const merged = new Set<string>(KNOWN_KEYS);
  for (const entry of customDictionary) {
    const validEntry = toValidDictionaryEntry(entry);
    if (validEntry !== undefined) {
      merged.add(validEntry);
    }
  }

  const mergedArray = [...merged];
  dictionaryCache.set(customDictionary, mergedArray);
  return mergedArray;
}

/**
 * Validate an environment variable key name.
 */
export function validateKey(
  key: string,
  customDictionary?: readonly string[],
): KeyValidationResult {
  const syntaxResult = validateKeySyntax(key);
  if (!syntaxResult.valid) {
    return syntaxResult;
  }

  const dictionary = mergeDictionaries(customDictionary);
  if (dictionary.includes(key)) {
    return { valid: true, warnings: EMPTY_WARNINGS };
  }

  const suggestion = findSuggestion(key, dictionary);
  return suggestion === undefined
    ? { valid: true, warnings: EMPTY_WARNINGS }
    : { valid: true, warnings: [suggestionMessage(key, suggestion)] };
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

  if (key === '') {
    return err(
      new AppError(
        ErrorCode.SET_INVALID_ASSIGNMENT,
        `Invalid assignment "${assignment}". Key cannot be empty.`,
      ),
    );
  }
  const validationResult = validateKey(key, customDictionary);
  if (!validationResult.valid) {
    return err(new AppError(ErrorCode.SET_INVALID_ASSIGNMENT, validationResult.error));
  }

  return ok({ key, value, warnings: validationResult.warnings });
}
