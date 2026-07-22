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

// ADR-007 §1 soft-warn tiers (t/1695) — advisory early warning BELOW the hard-fail
// ceiling (non-test 1000, test 1500). A single core `max-lines` instance can't emit
// warn@soft AND error@hard (one rule per file, last-match-wins), so this tiny co-located
// rule counts lines the same way core max-lines does (all physical lines, trailing
// newline dropped) and reports at 'warn'. It NEVER fails the build.
// ⚠ t/1692 coordination: do NOT wire `npm run lint --max-warnings=0` in CI — that turns
// these advisory warnings into hard failures and red-walls the soft-band files ADR-007
// intends only to warn on. Wire lib lint with warnings tolerated (or an explicit baseline
// count), not --max-warnings=0.
const SOFT_WARN_SRC = 1000;
const SOFT_WARN_TEST = 1500;
const budgetPlugin = {
  rules: {
    'soft-warn': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn when a file trends toward the ADR-007 hard-fail LOC ceiling.' },
        schema: [{ type: 'object', properties: { max: { type: 'number' } }, additionalProperties: false }],
        messages: {
          trending: 'File has {{count}} lines (soft budget {{max}}); trending toward the ADR-007 hard ceiling — plan a cohesion extraction (epic t/1681).',
        },
      },
      create(context) {
        const max = context.options[0]?.max ?? SOFT_WARN_SRC;
        return {
          Program(node) {
            const text = context.sourceCode.getText();
            const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
            if (count > max) {
              context.report({ node, messageId: 'trending', data: { count, max } });
            }
          },
        };
      },
    },
  },
};

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
    plugins: { budget: budgetPlugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { attributes: false },
      }],
      'max-lines': MAX_LINES_SRC,
      'budget/soft-warn': ['warn', { max: SOFT_WARN_SRC }],
    },
  },

  // ── Block A-tsx: LOC budget for non-test .tsx (syntactic parse; not in tsconfig project) ──
  {
    files: ['**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/*.spec.tsx', '**/__tests__/**'],
    extends: [tseslint.configs.base],
    plugins: { budget: budgetPlugin },
    rules: {
      'max-lines': MAX_LINES_SRC,
      'budget/soft-warn': ['warn', { max: SOFT_WARN_SRC }],
    },
  },

  // ── Block B: LOC budget for test source (syntactic parse; tests excluded from tsconfig) ──
  // Deliberately NOT the async-safety rules — un-ignoring tests only to enforce the ceiling,
  // not to surface pre-existing floating-promise violations in tests as new gate noise.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
    extends: [tseslint.configs.base],
    plugins: { budget: budgetPlugin },
    rules: {
      'max-lines': MAX_LINES_TEST,
      'budget/soft-warn': ['warn', { max: SOFT_WARN_TEST }],
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
      'debate/debateEngine.ts',         // 4233
      'debate/turnPipeline.ts',         // 2863
      'debate/claimExtractionPipeline.ts', // 1542
      'debate/debateEngine.test.ts',    // 2071 (test ceiling 2000)
    ],
    plugins: { budget: budgetPlugin },
    rules: {
      'max-lines': 'off',
      'budget/soft-warn': 'off',
    },
  },

  {
    ignores: ['node_modules/', 'dist/'],
  },
);
