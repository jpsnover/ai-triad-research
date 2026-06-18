// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ESLint flat config — async safety rules only.
// Catches fire-and-forget promises and async/sync callback mismatches.
// No style or formatting rules — Prettier handles that.

import tseslint from 'typescript-eslint';
import requireFlightRecorderInCatch from './eslint-rules/require-flight-recorder-in-catch.js';

const localPlugin = {
  rules: {
    'require-flight-recorder-in-catch': requireFlightRecorderInCatch,
  },
};

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.base],
    plugins: { local: localPlugin },
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
      '@typescript-eslint/no-use-before-define': ['error', {
        functions: false,
        classes: true,
        variables: true,
        allowNamedExports: false,
      }],
      'complexity': ['warn', { max: 15 }],
      'local/require-flight-recorder-in-catch': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/', '**/*.test.ts', '**/*.test.tsx', '**/__tests__/'],
  },
);
