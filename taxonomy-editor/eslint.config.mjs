// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ESLint flat config — async safety + ADR-007 file-size budget.
//
// Two concerns:
//  1. Async safety (fire-and-forget promises, async/sync callback mismatches) plus
//     flight-recorder-in-catch (ADR-003). Type-aware; Prettier owns formatting.
//  2. File-size budget (ADR-007, t/1691) — the max-lines anti-regression gate,
//     mirroring the lib/ half (t/1685). Thresholds: non-test source 1500, test source
//     2000, both counting blank + comment lines (skipBlankLines/skipComments:false)
//     for one stable number. Existing offenders are baselined in Block C and the
//     baseline shrinks monotonically to zero as the epic t/1681 Phase-2 splits land.
//     ADR-007 §1 soft-warn tiers are deliberately deferred here: `npm run verify` caps
//     warnings at --max-warnings=4256, so advisory warns would count against that
//     ceiling and risk hard failures — hard-gate only (TL ruling, t/1691#2).

import tseslint from 'typescript-eslint';
import requireFlightRecorderInCatch from '../lib/eslint-rules/require-flight-recorder-in-catch.js';
import noUnmanagedModuleResources from './eslint-rules/no-unmanaged-module-resources.js';
import noInlineStyle from './eslint-rules/no-inline-style.js';

const localPlugin = {
  rules: {
    'require-flight-recorder-in-catch': requireFlightRecorderInCatch,
    'no-unmanaged-module-resources': noUnmanagedModuleResources,
    'no-inline-style': noInlineStyle,
  },
};

// ADR-007 max-lines thresholds — count every physical line (no skip) for one stable number.
const MAX_LINES_SRC = ['error', { max: 1500, skipBlankLines: false, skipComments: false }];
const MAX_LINES_TEST = ['error', { max: 2000, skipBlankLines: false, skipComments: false }];

// Test-file globs — excluded from the type-aware async/FR blocks (they are un-ignored
// globally only to enforce the LOC ceiling in Block B, not to surface pre-existing
// floating-promise / no-flight-recorder violations in tests as new gate noise).
const TEST_GLOBS = ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/__tests__/**'];

export default tseslint.config(
  // ── Block A: async safety + FR + LOC budget for non-test source (type-aware) ──
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: TEST_GLOBS,
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
      // ADR-003 enforcement (t/1323, repo-review B-401): every catch records to the
      // flight recorder. Flipped warn→error once the tree was clean (0 violations).
      'local/require-flight-recorder-in-catch': 'error',
      'max-lines': MAX_LINES_SRC,
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    ignores: TEST_GLOBS,
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'local/no-unmanaged-module-resources': 'warn',
      'local/no-inline-style': 'warn',
    },
  },
  // ── Block B: LOC budget for test source (syntactic parse; tests are outside the
  //    tsconfig project). Deliberately NOT the async/FR rules — un-ignoring tests only
  //    to enforce the ceiling, not to surface pre-existing test violations as gate noise. ──
  {
    files: TEST_GLOBS,
    extends: [tseslint.configs.base],
    rules: {
      'max-lines': MAX_LINES_TEST,
    },
  },

  // ── Generated-file exemption (ADR-007) ──
  // Flat-config `files` globs match by PATH, not content, so a `@generated`-header match
  // is not natively expressible. taxonomy-editor has no generated .ts/.tsx today. When one
  // is added, exempt it here by path, e.g.:
  //   { files: ['src/path/to/generated.ts'], rules: { 'max-lines': 'off' } },

  // ── Block C: offender baseline (ADR-007, epic t/1681) — SHRINKS MONOTONICALLY TO ZERO ──
  // Each entry is the current LOC (origin/main scan 2026-07-22). Remove an entry as its
  // Phase-2 split lands the file under budget. Do NOT add entries for new files — new
  // growth must fail. (ipcHandlers.ts was dropped once t/1689's split landed on
  // origin/main — 38 LOC, under budget.)
  {
    files: [
      // JUSTIFIED STANDING EXCEPTION (t/1688 ruling C) — NOT a pending shrink.
      // Monolithic stateful backend: the transport-seam split (GitHubRestClient) alone
      // lands ~1736 (still >1500), and clearing the ceiling forces a high-risk rewire of
      // the prod disk-cache/manifest layer (58 `this.manifest` sites). Deferred as
      // asymmetric risk. Revisit only if the optional GitHubRestClient follow-up lands.
      'src/server/storage/githubAPIBackend.ts',  // 2169 — justified exception (t/1688)
    ],
    rules: {
      'max-lines': 'off',
    },
  },

  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },
);
