// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Model-literal lint gate (t/3559 Gap B; t/3657 conditions 1-3). WARN-only for now — the blocking flip is
// TL's separate step (condition 5, Gate-Verification + mandatory SO). Mirrors tests/ModelLiteralLint.Tests.ps1
// and shares the conformance corpus (modelLiteralLint.conformance.test.ts).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  findModelLiterals,
  lintModelLiterals,
  classifyLiteral,
  parseMarker,
  countExemptionsByKind,
  assertModelRegistryUsable,
  MARKER_KINDS,
  SUPPRESS_MARKER,
  type SourceFile,
  type MarkerKind,
} from './modelLiteralLint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/ai-config/ -> lib/ -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../');

// ── Authority: ai-models.json models[].id (the SAME field AITriad.psm1:642 projects) ──────────────
interface Registry { models: { id: string }[] }
const registry: Registry = JSON.parse(readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8'));
const VALID_IDS: ReadonlySet<string> = new Set(registry.models.map((m) => m.id));

// ── Production-TS file collection (IO — the impure caller; the predicate stays pure) ───────────────
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

describe('model-literal lint — real tree passes at zero tolerated noise (t/3559 AC; t/3657 bare-marker migration)', () => {
  it('no production TS literal is unresolved, and every exemption uses a VALID typed marker', () => {
    // After t/3657 every bare `model-lint:allow` was migrated to a typed kind or the id was made to
    // resolve; a surviving bare/no-reason marker now shows up here as an offender.
    const offenders = lintModelLiterals(PRODUCTION_FILES, VALID_IDS);
    expect(offenders, offenders.map((o) => `${o.kind}: ${o.message}`).join('\n')).toEqual([]);
  });
});

describe('model-literal lint — resolution both arms + exclusions (pure, fixture-driven)', () => {
  const valid = new Set(['claude-opus-5', 'gemini-3.5-flash-lite']);
  const scan = (content: string) => lintModelLiterals([{ path: 'fixture.ts', content }], valid);

  it('FLAGS an unregistered, unmarked literal with file:line, id, and the remedy', () => {
    const o = scan(`const m = 'claude-nonexistent-9';`);
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe('unregistered');
    expect(o[0].id).toBe('claude-nonexistent-9');
    expect(o[0].line).toBe(1);
    expect(o[0].message).toContain('fixture.ts:1');
    expect(o[0].message).toContain('register');
    expect(o[0].message).toContain(SUPPRESS_MARKER);
  });

  it('PASSES a literal that resolves to a registered id', () => {
    expect(scan(`const m = 'claude-opus-5';`)).toEqual([]);
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

describe('model-literal lint — marker grammar (t/3657 condition 1)', () => {
  const valid = new Set(['claude-opus-5']);
  const scan = (content: string) => lintModelLiterals([{ path: 'fixture.ts', content }], valid);

  it('parseMarker: distinguishes valid kinds, bare, no-reason, and no-marker', () => {
    expect(parseMarker(`x // ${SUPPRESS_MARKER}-pin deliberate pin`)).toEqual({ kind: 'pin', reason: 'deliberate pin' });
    expect(parseMarker(`x // ${SUPPRESS_MARKER}-external other registry`)).toEqual({ kind: 'external', reason: 'other registry' });
    expect(parseMarker(`x // ${SUPPRESS_MARKER}-nonselect display map`)).toEqual({ kind: 'nonselect', reason: 'display map' });
    expect(parseMarker(`x // ${SUPPRESS_MARKER}`)).toEqual({ invalid: 'bare' });
    expect(parseMarker(`x // ${SUPPRESS_MARKER}-pin`)).toEqual({ invalid: 'no-reason' });
    expect(parseMarker(`const m = 'claude-opus-5';`)).toBeNull();
  });

  it('classifyLiteral: the full verdict table (the single source of truth)', () => {
    expect(classifyLiteral('claude-opus-5', null, valid)).toBe('ok');
    expect(classifyLiteral('claude-retired-9', null, valid)).toBe('unregistered');
    expect(classifyLiteral('claude-retired-9', { invalid: 'bare' }, valid)).toBe('bare-marker');
    expect(classifyLiteral('claude-retired-9', { invalid: 'no-reason' }, valid)).toBe('no-reason-marker');
    expect(classifyLiteral('claude-retired-9', { kind: 'pin', reason: 'r' }, valid)).toBe('exempt');
    // contradiction — a valid marker on a REGISTERED id, uniform across all three kinds:
    for (const kind of MARKER_KINDS as readonly MarkerKind[]) {
      expect(classifyLiteral('claude-opus-5', { kind, reason: 'r' }, valid)).toBe('contradiction');
    }
  });

  it('FLAGS a bare marker (the ambiguous form must not survive)', () => {
    const o = scan(`const m = 'claude-retired-9'; // ${SUPPRESS_MARKER} — used to hide here`);
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe('bare-marker');
  });

  it('FLAGS a typed marker with no reason (reason is mandatory)', () => {
    const o = scan(`const m = 'claude-retired-9'; // ${SUPPRESS_MARKER}-pin`);
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe('no-reason-marker');
  });

  it('EXEMPTS an unregistered literal with a valid typed marker (each kind)', () => {
    expect(scan(`const m = 'claude-retired-9'; // ${SUPPRESS_MARKER}-pin deliberate pin`)).toEqual([]);
    expect(scan(`const m = 'gemini-embed-1'; // ${SUPPRESS_MARKER}-external embedding registry`)).toEqual([]);
    expect(scan(`const m = 'gemini-3.9-preview'; // ${SUPPRESS_MARKER}-nonselect display map`)).toEqual([]);
  });

  it('FLAGS a valid marker on a REGISTERED id as a contradiction (spurious exemption)', () => {
    const o = scan(`const m = 'claude-opus-5'; // ${SUPPRESS_MARKER}-pin but it IS registered`);
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe('contradiction');
  });
});

describe('model-literal lint — exemption ratchet (t/3657 condition 2)', () => {
  interface Baseline { pin: number; external: number; nonselect: number }
  const baseline: Baseline = JSON.parse(
    readFileSync(path.join(__dirname, 'modelLiteralLint.exemptions.baseline.json'), 'utf-8'),
  );

  it('countExemptionsByKind: counts valid exemptions per kind; contradictions are NOT exemptions', () => {
    const valid = new Set(['claude-opus-5']);
    const files: SourceFile[] = [
      { path: 'a.ts', content: `const a = 'claude-retired-9'; // ${SUPPRESS_MARKER}-pin r` },
      { path: 'b.ts', content: `const b = 'gemini-embed-1'; // ${SUPPRESS_MARKER}-external r` },
      { path: 'c.ts', content: `const c = 'gemini-3.9-preview'; // ${SUPPRESS_MARKER}-nonselect r` },
      { path: 'd.ts', content: `const d = 'claude-opus-5'; // ${SUPPRESS_MARKER}-pin contradiction, not counted` },
    ];
    expect(countExemptionsByKind(files, valid)).toEqual({ pin: 1, external: 1, nonselect: 1 });
  });

  it('RATCHET: no kind exceeds its committed baseline (bump the baseline file in the SAME commit to raise)', () => {
    const counts = countExemptionsByKind(PRODUCTION_FILES, VALID_IDS);
    for (const kind of MARKER_KINDS as readonly MarkerKind[]) {
      expect(
        counts[kind],
        `model-lint '${kind}' exemptions rose to ${counts[kind]}, above baseline ${baseline[kind]}. If this new ` +
          `exemption is legitimate, bump "${kind}" in lib/ai-config/modelLiteralLint.exemptions.baseline.json in ` +
          `this same commit (a reviewed diff). A rising 'nonselect' count instead means the extraction is over-broad.`,
      ).toBeLessThanOrEqual(baseline[kind]);
    }
  });
});

describe('model-literal lint — registry-unreadable discrimination (t/3657 condition 3)', () => {
  it('THROWS a distinct infra error on an empty id set — never "unregistered literal"', () => {
    let thrown: unknown;
    try {
      assertModelRegistryUsable(new Set());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    // The message must name the INFRA cause so the next person does not hunt a literal that was fine.
    expect((thrown as Error).message).toMatch(/infrastructure condition/i);
    expect((thrown as Error).message).toMatch(/unreadable or empty/i);
  });

  it('does NOT throw when the registry loaded a non-empty id set', () => {
    expect(() => assertModelRegistryUsable(VALID_IDS)).not.toThrow();
  });
});
