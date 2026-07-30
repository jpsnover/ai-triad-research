// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ESLint flat config — ADR-003 flight-recorder-in-catch enforcement.
// Consumes the single canonical rule shared across all apps (lib/eslint-rules,
// t/1929); no local fork. The typescript-eslint parser is wired so .ts/.tsx
// files parse (the rule is purely syntactic — no type-aware projectService
// needed). Rule is 'error' (ADR-003 hard gate): the mini-app catch tree is clean,
// so this ratchets to full parity with taxonomy-editor's 'error' enforcement
// (t/1976 warn→error, after t/1929 wired the rule to actually run here).

import tseslint from 'typescript-eslint';
import requireFlightRecorderInCatch from '../lib/eslint-rules/require-flight-recorder-in-catch.js';

const localPlugin = {
  rules: {
    'require-flight-recorder-in-catch': requireFlightRecorderInCatch,
  },
};

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: { local: localPlugin },
    rules: {
      'local/require-flight-recorder-in-catch': 'error',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },
);
