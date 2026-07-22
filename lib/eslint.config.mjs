// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ESLint flat config for @ai-triad/lib.
//
// Two concerns:
//  1. Async safety — fire-and-forget promises and async/sync callback mismatches
//     (type-aware; needs projectService). No style/formatting rules — Prettier owns that.
//  2. File-size budget (ADR-007) — max-lines anti-regression gate. ESLint is the
//     single source of truth for .ts/.tsx LOC across first-party packages
//     (check-quality-gates.sh is being narrowed to byte/css/tsc guards — DevOps t/1692).
//     Thresholds: non-test source 1500, test source 2000, both counting blank + comment
//     lines (skipBlankLines/skipComments:false) for one stable number. Existing offenders
//     are baselined below and the baseline shrinks monotonically to zero as the Phase-2
//     split tickets under epic t/1681 land under budget.

import tseslint from 'typescript-eslint';

// max-lines is not type-aware, so the .tsx and test blocks parse syntactically
// (no projectService) — those files are outside lib/tsconfig.json's `**/*.ts` project.
const MAX_LINES_SRC = ['error', { max: 1500, skipBlankLines: false, skipComments: false }];
const MAX_LINES_TEST = ['error', { max: 2000, skipBlankLines: false, skipComments: false }];

export default tseslint.config(
  // ── Block A: async safety + LOC budget for non-test source .ts (type-aware) ──
  {
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
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
      'max-lines': MAX_LINES_SRC,
    },
  },

  // ── Block A-tsx: LOC budget for non-test .tsx (syntactic parse; not in tsconfig project) ──
  {
    files: ['**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/*.spec.tsx', '**/__tests__/**'],
    extends: [tseslint.configs.base],
    rules: {
      'max-lines': MAX_LINES_SRC,
    },
  },

  // ── Block B: LOC budget for test source (syntactic parse; tests excluded from tsconfig) ──
  // Deliberately NOT the async-safety rules — un-ignoring tests only to enforce the ceiling,
  // not to surface pre-existing floating-promise violations in tests as new gate noise.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
    extends: [tseslint.configs.base],
    rules: {
      'max-lines': MAX_LINES_TEST,
    },
  },

  // ── Generated-file exemption (ADR-007) ──
  // Flat-config `files` globs match by PATH, not content, so a `@generated`-header match
  // is not natively expressible. lib has no generated .ts/.tsx today. When one is added,
  // exempt it here by path, e.g.:
  //   { files: ['path/to/generated.ts'], rules: { 'max-lines': 'off' } },

  // ── Block C: offender baseline (ADR-007, epic t/1681) — SHRINKS MONOTONICALLY TO ZERO ──
  // Each entry is the current LOC (scan 2026-07-22). Remove an entry as its Phase-2 split
  // lands the file under budget. Do NOT add entries for new files — new growth must fail.
  {
    files: [
      'debate/prompts.ts',              // 4667
      'debate/debateEngine.ts',         // 4233
      'debate/turnPipeline.ts',         // 2863
      'debate/types.ts',                // 2232
      'debate/calibrationLogger.ts',    // 2038
      'debate/argumentNetwork.ts',      // 1632
      'debate/turnValidator.ts',        // 1617
      'debate/claimExtractionPipeline.ts', // 1542
      'debate/debateEngine.test.ts',    // 2071 (test ceiling 2000)
    ],
    rules: {
      'max-lines': 'off',
    },
  },

  {
    ignores: ['node_modules/', 'dist/'],
  },
);
