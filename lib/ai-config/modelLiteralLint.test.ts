// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Model-literal lint gate (t/3559, Gap B of t/3557). WARN-only for now — promotion to blocking is a
// separate step (TL Gate-Verification + mandatory SO). Mirrors tests/ModelLiteralLint.Tests.ps1.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  findModelLiterals,
  lintModelLiterals,
  SUPPRESS_MARKER,
  type SourceFile,
} from './modelLiteralLint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/ai-config/ -> lib/ -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../');

// ── Authority: ai-models.json models[].id (the SAME field AITriad.psm1:642 projects) ──────────────
interface Registry { models: { id: string }[] }
const registry: Registry = JSON.parse(readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'));
const VALID_IDS: ReadonlySet<string> = new Set(registry.models.map((m) => m.id));

// ── Production-TS file collection (IO — the impure caller; the predicate stays pure) ───────────────
// Scope: lib/** + taxonomy-editor/src/**. Exclude tests, specs, mocks, fixtures, test-support helpers,
// type decls, generated files, and non-source trees (t/3559 scoping + t/3559#3 refinement b).
const SCAN_ROOTS = ['lib', 'taxonomy-editor/src'];
const EXCLUDE_DIR = new Set(['node_modules', 'dist', '__tests__', '__mocks__', 'fixtures', '.git']);
function isExcludedFile(name: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(name) ||
    /\.d\.ts$/.test(name) ||
    /\.testHelpers\.ts$/.test(name) ||
    /\.mock\.ts$/.test(name) ||
    name === 'generatedAIModelIds.ts'
  );
}
function collectProductionTsFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const ent of readdirSync(absDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (EXCLUDE_DIR.has(ent.name)) continue;
        walk(path.join(absDir, ent.name), `${relDir}/${ent.name}`);
      } else if (/\.tsx?$/.test(ent.name) && !isExcludedFile(ent.name)) {
        const rel = `${relDir}/${ent.name}`;
        out.push({ path: rel, content: readFileSync(path.join(absDir, ent.name), 'utf-8') });
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), root);
  return out;
}
const PRODUCTION_FILES = collectProductionTsFiles();

describe('model-literal lint — required guards (t/3559)', () => {
  it('EMPTY-AUTHORITY guard: ai-models.json id set is non-empty (a load failure fails loudly)', () => {
    expect(VALID_IDS.size).toBeGreaterThan(0);
  });

  it('VACUOUS-LINT guard: the real-tree scan actually finds model-ID literals (a broken regex fails)', () => {
    const total = PRODUCTION_FILES.reduce((n, f) => n + findModelLiterals(f).length, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe('model-literal lint — real tree passes at zero tolerated noise (t/3559 AC)', () => {
  it('no production TS literal names an unregistered model without a co-located marker', () => {
    const offenders = lintModelLiterals(PRODUCTION_FILES, VALID_IDS);
    // Full hit list in the failure message so a new offender is actionable at a glance.
    expect(offenders, offenders.map((o) => o.message).join('\n')).toEqual([]);
  });
});

describe('model-literal lint — predicate both arms + exclusions (pure, fixture-driven)', () => {
  const valid = new Set(['claude-opus-5', 'gemini-3.5-flash-lite']);
  const scan = (content: string) => lintModelLiterals([{ path: 'fixture.ts', content }], valid);

  it('FLAGS an unregistered, unmarked literal with file:line, id, and the three remedies', () => {
    const o = scan(`const m = 'claude-nonexistent-9';`);
    expect(o).toHaveLength(1);
    expect(o[0].id).toBe('claude-nonexistent-9');
    expect(o[0].line).toBe(1);
    expect(o[0].message).toContain('fixture.ts:1');
    expect(o[0].message).toContain('register it');
    expect(o[0].message).toContain(SUPPRESS_MARKER);
  });

  it('PASSES a literal that resolves to a registered id', () => {
    expect(scan(`const m = 'claude-opus-5';`)).toEqual([]);
  });

  it('PASSES an unregistered literal carrying the co-located marker', () => {
    expect(scan(`const m = 'claude-nonexistent-9'; // ${SUPPRESS_MARKER} — deliberate pin`)).toEqual([]);
  });

  it('EXCLUDES a dated wire apiModelId (never a models[].id selection)', () => {
    expect(scan(`const probe = 'claude-opus-5-20260115';`)).toEqual([]);
  });

  it('EXCLUDES an uppercase prose token like "GPT-4o" (lowercase-only match)', () => {
    expect(scan(`// normalize entity names such as "GPT-4o" here`)).toEqual([]);
  });

  it('EXCLUDES a key-prefix string with no version digit (gemini-key)', () => {
    expect(scan(`const envKey = 'gemini-key';`)).toEqual([]);
  });

  it('EXCLUDES a trailing-dash regex fragment (claude-3.5-)', () => {
    expect(scan(`const frag = 'claude-3.5-';`)).toEqual([]);
  });
});
