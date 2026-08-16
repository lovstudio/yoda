import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  globalIgnores([
    'dist/**',
    'services/*/dist/**',
    'packages/*/dist/**',
    'docs/dist/**',
    'out/**',
    'build/**',
    'node_modules/**',
    // The DSH plugin's build output: bundled third-party code wrapped in a
    // browser module-loader closure, linted by nothing that owns it.
    'packages/dsh-runtime-bar/lib/**',
    // Vite's pre-bundled dependency cache. It lives inside the checkout so that
    // parallel worktrees cannot overwrite each other's chunks, which also puts
    // thousands of generated files in lint's path.
    '.vite/**',
    '**/_*/**',
    // Worktrees are full checkouts that lint themselves — don't double-lint
    // them (or their build artifacts) from the parent checkout.
    '.worktrees/**',
  ]),

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,

  // Non-type-aware rules for all TS/TSX files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2020 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
    },
  },

  // Landing-page browser scripts (docs/ static site)
  {
    files: ['docs/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2020 },
    },
  },

  // Type-aware rules scoped to src/ only (config files like vitest.config.ts are not in tsconfig)
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      // Allow async functions as React event handler attributes (onClick={asyncFn} is idiomatic)
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'warn',
    },
  },

  // Relax rules for test files
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
