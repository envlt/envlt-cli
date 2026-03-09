/**
 * Compute the Levenshtein edit distance between two strings.
 * Pure function, O(m*n) time and space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (a.length === 0) {
    return b.length;
  }

  if (b.length === 0) {
    return a.length;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = new Uint16Array(rows * cols);

  const cellIndex = (row: number, col: number): number => row * cols + col;

  for (let i = 0; i < rows; i += 1) {
    matrix[cellIndex(i, 0)] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    matrix[cellIndex(0, j)] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = Number(matrix[cellIndex(i - 1, j)]) + 1;
      const insertion = Number(matrix[cellIndex(i, j - 1)]) + 1;
      const substitution = Number(matrix[cellIndex(i - 1, j - 1)]) + substitutionCost;
      matrix[cellIndex(i, j)] = Math.min(deletion, insertion, substitution);
    }
  }

  return Number(matrix[cellIndex(a.length, b.length)]);
}
