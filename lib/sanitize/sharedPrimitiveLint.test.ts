// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

/**
 * Source-scan lint: guards against re-introducing inline copies of shared primitives
 * extracted under lib/sanitize/ and lib/entities/ (t/2085, prevention for t/2079).
 *
 * SCAN SCOPE: lib/, taxonomy-editor/src/, poviewer/src/, summary-viewer/src/,
 * workflow-app/src/ (.ts/.tsx, excluding node_modules/, dist/, *.test.ts, __tests__/).
 * This equals the `electron` paths-filter in ci.yml:80-87 — a re-introduction outside
 * this scope (e.g. scripts/**) would be ungated. Widening the filter is not worth the
 * CI cost; see t/2085#1.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ──────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'lib'),
  path.join(REPO_ROOT, 'taxonomy-editor', 'src'),
  path.join(REPO_ROOT, 'poviewer', 'src'),
  path.join(REPO_ROOT, 'summary-viewer', 'src'),
  path.join(REPO_ROOT, 'workflow-app', 'src'),
];

const OWNERS = {
  stripSensitiveKeys: path.join(REPO_ROOT, 'lib', 'sanitize', 'stripSensitiveKeys.ts'),
  entityResolve:      path.join(REPO_ROOT, 'lib', 'entities', 'entityResolve.ts'),
  contentSanitizer:   path.join(REPO_ROOT, 'lib', 'sanitize', 'contentSanitizerCore.ts'),
};

// ── File walker ────────────────────────────────────────────────────────────

const SKIP_DIRS  = new Set(['node_modules', 'dist', '__tests__']);
const SKIP_FILES = /\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/;

function collectSourceFiles(roots: string[]): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (/\.[cm]?[jt]sx?$/.test(e.name) && !SKIP_FILES.test(e.name)) {
        results.push(full);
      }
    }
  }
  for (const root of roots) walk(root);
  return results;
}

// ── Sentinel definitions ────────────────────────────────────────────────────
// Each entry: { pattern, ownerPath, label }
// Pattern anchors on the *definition* keyword so loose literals inside the owning
// module's own string/regex literals are not a false positive.

const SENTINELS = [
  {
    label: 'SENSITIVE_KEYS definition',
    pattern: /(?:const|let|var)\s+SENSITIVE_KEYS\b/,
    ownerPath: OWNERS.stripSensitiveKeys,
  },
  {
    label: 'SECRET_PREFIX_RE definition',
    pattern: /(?:const|let|var)\s+SECRET_PREFIX_RE\b/,
    ownerPath: OWNERS.stripSensitiveKeys,
  },
  {
    // Covers both `function resolveMergedInto(` and `const resolveMergedInto =`/`:`
    label: 'resolveMergedInto / normalizeEntity / coerceStringArray definition',
    pattern: /(?:(?:export\s+)?function|const)\s+(?:resolveMergedInto|normalizeEntity|coerceStringArray)\s*[<(=:]/,
    ownerPath: OWNERS.entityResolve,
  },
  {
    // Covers both `function sanitizeText(` and `const sanitizeText =`/`:`
    label: 'sanitizeText definition',
    pattern: /(?:(?:export\s+)?function|const)\s+sanitizeText\s*[<(=:]/,
    ownerPath: OWNERS.contentSanitizer,
  },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function linesMatching(content: string, re: RegExp): number[] {
  return content.split('\n').reduce<number[]>((acc, line, idx) => {
    if (re.test(line)) acc.push(idx + 1);
    return acc;
  }, []);
}

function findViolations(files: string[], sentinel: (typeof SENTINELS)[number]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (path.normalize(file) === path.normalize(sentinel.ownerPath)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = linesMatching(content, sentinel.pattern);
    for (const ln of lines) {
      violations.push(`${path.relative(REPO_ROOT, file)}:${ln}`);
    }
  }
  return violations;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('sharedPrimitiveLint — no re-introduced inline copies (t/2085)', () => {
  const ALL_FILES = collectSourceFiles(SCAN_ROOTS);

  // ── Vacuity guard 1: file set is non-empty ─────────────────────────────
  it('resolves a non-empty source file set', () => {
    expect(ALL_FILES.length).toBeGreaterThan(50);
  });

  // ── Vacuity guard 2: each sentinel regex matches its owning file ────────
  // If a regex breaks, this fails instead of the lint going quietly green.
  it('each sentinel regex matches its owning module', () => {
    for (const sentinel of SENTINELS) {
      const content = fs.readFileSync(sentinel.ownerPath, 'utf8');
      const lines = linesMatching(content, sentinel.pattern);
      expect(
        lines.length,
        `sentinel "${sentinel.label}" did not match in ${path.relative(REPO_ROOT, sentinel.ownerPath)} — regex may be stale`,
      ).toBeGreaterThan(0);
    }
  });

  // ── False-positive guards ───────────────────────────────────────────────
  // These files contain related-but-distinct constructs that name-anchored
  // sentinels must NOT flag. Asserted as executable tests so loosening a regex
  // fails loudly rather than silently widening the allowlist.

  it('does not flag lib/flight-recorder/redact.ts (per-provider log-scrubbing regexes, separate threat model from submission stripping; defines neither SENSITIVE_KEYS nor SECRET_PREFIX_RE by name)', () => {
    const redactFile = path.join(REPO_ROOT, 'lib', 'flight-recorder', 'redact.ts');
    const content = fs.readFileSync(redactFile, 'utf8');
    for (const sentinel of SENTINELS) {
      const lines = linesMatching(content, sentinel.pattern);
      expect(lines, `sentinel "${sentinel.label}" unexpectedly matched redact.ts`).toHaveLength(0);
    }
  });

  it('does not flag bootstrap.ts / loginPage.ts (escapeHtml for inline <script> interpolation — an HTML escaper, not a content sanitizer; defines neither sentinel name)', () => {
    const targets = [
      path.join(REPO_ROOT, 'taxonomy-editor', 'src', 'renderer', 'bootstrap.ts'),
      path.join(REPO_ROOT, 'taxonomy-editor', 'src', 'server', 'loginPage.ts'),
    ];
    for (const file of targets) {
      const content = fs.readFileSync(file, 'utf8');
      for (const sentinel of SENTINELS) {
        const lines = linesMatching(content, sentinel.pattern);
        expect(lines, `sentinel "${sentinel.label}" unexpectedly matched ${path.basename(file)}`).toHaveLength(0);
      }
    }
  });

  it('does not flag lib/debate/policyScoring.ts (merged_into? is a type field, not a resolver function; const/function sentinels do not match a bare object property)', () => {
    const file = path.join(REPO_ROOT, 'lib', 'debate', 'policyScoring.ts');
    const content = fs.readFileSync(file, 'utf8');
    for (const sentinel of SENTINELS) {
      const lines = linesMatching(content, sentinel.pattern);
      expect(lines, `sentinel "${sentinel.label}" unexpectedly matched policyScoring.ts`).toHaveLength(0);
    }
  });

  // ── Main lint: no sentinel outside its owning module ───────────────────
  for (const sentinel of SENTINELS) {
    it(`no re-introduced "${sentinel.label}" outside ${path.relative(REPO_ROOT, sentinel.ownerPath)}`, () => {
      const violations = findViolations(ALL_FILES, sentinel);
      expect(
        violations,
        `Found inline copies of "${sentinel.label}" — extract or import from the shared module:\n  ${violations.join('\n  ')}`,
      ).toHaveLength(0);
    });
  }
});
