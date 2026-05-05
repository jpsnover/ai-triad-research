// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ESLint flat config — async safety rules only.
// Catches fire-and-forget promises and async/sync callback mismatches.
// No style or formatting rules — Prettier handles that.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { attributes: false },
      }],
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/', '**/*.test.ts', '**/*.test.tsx', '**/__tests__/'],
  },
);
