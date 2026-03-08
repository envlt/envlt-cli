import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const typeCheckedConfigs = [
  ...tseslint.configs['flat/recommended-type-checked'],
  ...tseslint.configs['flat/strict-type-checked'],
].map((config) => ({
  ...config,
  files: ['**/*.ts'],
}));

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  ...typeCheckedConfigs,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      'no-process-exit': 'error',
      eqeqeq: 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['bin/*.ts'],
    rules: {
      'no-process-exit': 'off',
    },
  },
];
