// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// TS↔PS parity test for findSituationBdiViolations / validateBdiFields — t/3889
// The "TS↔PS live parity" block invokes Test-SituationBdiDecomposition.ps1 via pwsh
// on the same fixture set and asserts both predicates identify identical failing node IDs.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSituationBdiViolations, validateBdiFields } from './taxonomyTypes.js';
import type { SituationNode, Interpretation } from './taxonomyTypes.js';

// Type-level check: Interpretation is now BdiInterpretation-only — plain strings are rejected.
// @ts-expect-error Interpretation no longer accepts plain strings (t/3889)
const _typeCheck: Interpretation = 'legacy string';
void _typeCheck;

// ── Helpers ─────────────────────────────────────────────

function makeNode(
  id: string,
  interpretations: SituationNode['interpretations'],
  description?: string,
): SituationNode {
  return {
    id,
    label: `Test node ${id}`,
    description: description ?? 'A test situation node.',
    interpretations,
    linked_nodes: [],
    conflict_ids: [],
  };
}

const GOOD_ACC = { belief: 'AI capabilities growing fast', desire: 'Accelerate AI development', intention: 'Remove safety constraints', summary: 'Push acceleration' };
const GOOD_SAF = { belief: 'AI risks are real and underweighted', desire: 'Safe and aligned AI systems', intention: 'Enforce robust alignment research', summary: 'Prioritize safety' };
const GOOD_SKP = { belief: 'Outcomes remain highly uncertain', desire: 'Empirical caution over hype', intention: 'Monitor, evaluate, avoid lock-in', summary: 'Maintain skepticism' };

// ── PS runner ────────────────────────────────────────────

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const PS_SCRIPT = join(REPO_ROOT, 'scripts', 'AITriad', 'Private', 'Test-SituationBdiDecomposition.ps1');

let pwshAvailable = false;
try {
  execFileSync('pwsh', ['--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  pwshAvailable = true;
} catch {
  // pwsh not in PATH — TS↔PS live parity block will be skipped
}

interface PsDecompositionResult {
  Pass: number; NonDeprecated: number; Deprecated: number;
  NonDecomposed: number; Empty: number; Fail: number;
  NonDecomposedIds: string[]; EmptyIds: string[];
}

function runPsCheck(nodes: SituationNode[]): PsDecompositionResult {
  const tempPath = join(tmpdir(), `bdi-parity-${process.pid}-${Date.now()}.json`);
  try {
    writeFileSync(tempPath, JSON.stringify(nodes), 'utf-8');
    const fwdTemp = tempPath.replace(/\\/g, '/');
    const fwdScript = PS_SCRIPT.replace(/\\/g, '/');
    const cmd = `$n = Get-Content '${fwdTemp}' -Raw | ConvertFrom-Json; . '${fwdScript}'; Test-SituationBdiDecomposition -Node $n | ConvertTo-Json -Compress`;
    const raw = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf-8' });
    const parsed = JSON.parse(raw) as Partial<PsDecompositionResult>;
    return {
      Pass: parsed.Pass ?? 0, NonDeprecated: parsed.NonDeprecated ?? 0,
      Deprecated: parsed.Deprecated ?? 0, NonDecomposed: parsed.NonDecomposed ?? 0,
      Empty: parsed.Empty ?? 0, Fail: parsed.Fail ?? 0,
      NonDecomposedIds: parsed.NonDecomposedIds ?? [],
      EmptyIds: parsed.EmptyIds ?? [],
    };
  } finally {
    rmSync(tempPath, { force: true });
  }
}

// ── validateBdiFields — unit ──────────────────────────────

describe('validateBdiFields — unit (t/3889)', () => {
  it('accepts complete BDI with all fields', () => {
    expect(validateBdiFields(GOOD_ACC)).toBeNull();
  });

  it('accepts BDI without summary — summary is NOT a required field', () => {
    const { summary: _s, ...noSummary } = GOOD_ACC;
    expect(validateBdiFields(noSummary)).toBeNull();
  });

  it('rejects a plain string (not-object)', () => {
    expect(validateBdiFields('legacy string interpretation')).toBe('not-object');
  });

  it('rejects null (not-object)', () => {
    expect(validateBdiFields(null)).toBe('not-object');
  });

  it('rejects undefined (not-object)', () => {
    expect(validateBdiFields(undefined)).toBe('not-object');
  });

  it('rejects empty belief', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: '' })).toBe('belief: blank or sentinel');
  });

  it('rejects whitespace-only belief (trims to empty)', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: '   ' })).toBe('belief: blank or sentinel');
  });

  it('rejects sentinel "null" in desire', () => {
    expect(validateBdiFields({ ...GOOD_ACC, desire: 'null' })).toBe('desire: blank or sentinel');
  });

  it('rejects sentinel "NULL" in desire (case-insensitive)', () => {
    expect(validateBdiFields({ ...GOOD_ACC, desire: 'NULL' })).toBe('desire: blank or sentinel');
  });

  it('rejects sentinel "none" in intention', () => {
    expect(validateBdiFields({ ...GOOD_ACC, intention: 'none' })).toBe('intention: blank or sentinel');
  });

  it('rejects sentinel "n/a" (lowercase)', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: 'n/a' })).toBe('belief: blank or sentinel');
  });

  it('rejects sentinel "N/A" (uppercase)', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: 'N/A' })).toBe('belief: blank or sentinel');
  });

  it('rejects sentinel "tbd"', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: 'tbd' })).toBe('belief: blank or sentinel');
  });

  it('rejects sentinel "-"', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: '-' })).toBe('belief: blank or sentinel');
  });

  it('does NOT reject text that contains a sentinel word but is not a whole-value match', () => {
    expect(validateBdiFields({ ...GOOD_ACC, belief: 'none of the above' })).toBeNull();
    expect(validateBdiFields({ ...GOOD_ACC, belief: 'N/A in certain contexts' })).toBeNull();
  });

  it('does NOT check summary — sentinel in summary is allowed', () => {
    expect(validateBdiFields({ ...GOOD_ACC, summary: 'null' })).toBeNull();
    expect(validateBdiFields({ ...GOOD_ACC, summary: '' })).toBeNull();
    expect(validateBdiFields({ ...GOOD_ACC, summary: '-' })).toBeNull();
  });

  it('returns the first failing field (belief before desire before intention)', () => {
    const result = validateBdiFields({ belief: '', desire: 'none', intention: '-', summary: 'ok' });
    expect(result).toBe('belief: blank or sentinel');
  });
});

// ── findSituationBdiViolations — TS behaviour ────────────

describe('findSituationBdiViolations — TS behaviour (t/3889)', () => {
  it('returns empty array for a fully compliant node', () => {
    const node = makeNode('saf-001', { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: GOOD_SKP });
    expect(findSituationBdiViolations([node])).toEqual([]);
  });

  it('flags a flat string interpretation (PS: NonDecomposedIds bucket)', () => {
    const node = makeNode('saf-002', {
      accelerationist: 'legacy flat string',
      safetyist: GOOD_SAF,
      skeptic: GOOD_SKP,
    });
    const violations = findSituationBdiViolations([node]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ id: 'saf-002', pov: 'accelerationist', reason: 'not-object' });
  });

  it('flags empty belief field (PS: NonDecomposedIds bucket)', () => {
    const node = makeNode('acc-003', {
      accelerationist: GOOD_ACC,
      safetyist: { ...GOOD_SAF, belief: '' },
      skeptic: GOOD_SKP,
    });
    const violations = findSituationBdiViolations([node]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ id: 'acc-003', pov: 'safetyist', reason: 'belief: blank or sentinel' });
  });

  it('flags sentinel "N/A" in intention (case-insensitive)', () => {
    const node = makeNode('skp-004', {
      accelerationist: GOOD_ACC,
      safetyist: GOOD_SAF,
      skeptic: { ...GOOD_SKP, intention: 'N/A' },
    });
    const violations = findSituationBdiViolations([node]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ id: 'skp-004', pov: 'skeptic', reason: 'intention: blank or sentinel' });
  });

  it('flags multiple violating POVs on the same node', () => {
    const node = makeNode('mix-005', {
      accelerationist: 'flat string',
      safetyist: { ...GOOD_SAF, desire: 'tbd' },
      skeptic: GOOD_SKP,
    });
    const violations = findSituationBdiViolations([node]);
    expect(violations).toHaveLength(2);
    expect(violations.map(v => v.pov).sort()).toEqual(['accelerationist', 'safetyist']);
  });

  it('exempts node whose description starts with [DEPRECATED]', () => {
    const node = makeNode(
      'dep-006',
      { accelerationist: 'flat', safetyist: 'flat', skeptic: 'flat' },
      '[DEPRECATED] This node is retired.',
    );
    expect(findSituationBdiViolations([node])).toEqual([]);
  });

  it('exempts [DEPRECATED] with leading whitespace (trimStart)', () => {
    const node = makeNode(
      'dep-007',
      { accelerationist: 'flat', safetyist: 'flat', skeptic: 'flat' },
      '   [DEPRECATED] Leading whitespace.',
    );
    expect(findSituationBdiViolations([node])).toEqual([]);
  });

  it('does NOT exempt a node whose description contains [DEPRECATED] mid-text', () => {
    const node = makeNode(
      'dep-008',
      { accelerationist: 'flat', safetyist: GOOD_SAF, skeptic: GOOD_SKP },
      'This node is not [DEPRECATED].',
    );
    expect(findSituationBdiViolations([node]).some(v => v.id === 'dep-008')).toBe(true);
  });

  it('does NOT flag missing summary (summary is not a required BDI field)', () => {
    const { summary: _s, ...noSummary } = GOOD_ACC;
    const node = makeNode('nosummary-009', {
      accelerationist: noSummary,
      safetyist: GOOD_SAF,
      skeptic: GOOD_SKP,
    });
    expect(findSituationBdiViolations([node])).toEqual([]);
  });

  it('handles mixed array — only dirty node violations returned', () => {
    const good = makeNode('g-010', { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: GOOD_SKP });
    const bad = makeNode('b-011', {
      accelerationist: GOOD_ACC,
      safetyist: GOOD_SAF,
      skeptic: { ...GOOD_SKP, belief: '-' },
    });
    const violations = findSituationBdiViolations([good, bad]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ id: 'b-011', pov: 'skeptic', reason: 'belief: blank or sentinel' });
  });

  it('returns empty array for empty input', () => {
    expect(findSituationBdiViolations([])).toEqual([]);
  });

  it('sentinel "-" in desire is flagged (all five sentinels covered)', () => {
    const node = makeNode('sent-012', {
      accelerationist: { ...GOOD_ACC, desire: '-' },
      safetyist: GOOD_SAF,
      skeptic: GOOD_SKP,
    });
    expect(findSituationBdiViolations([node])).toHaveLength(1);
    expect(findSituationBdiViolations([node])[0]).toMatchObject({ pov: 'accelerationist', reason: 'desire: blank or sentinel' });
  });
});

// ── TS↔PS live parity — both predicates on identical fixtures ───────────────
// Shared fixture set covers: flat string, empty field, sentinel, [DEPRECATED]
// exemption (×2), multi-POV failure, and a clean node.
//
// PS output is per-node aggregate (NonDecomposedIds ∪ EmptyIds = failing IDs).
// TS output is per-POV detailed. Parity assertion: same set of distinct failing IDs.
//
// Skipped automatically when pwsh is not in PATH.

const PARITY_FIXTURES: SituationNode[] = [
  // par-clean: fully compliant — both pass
  makeNode('par-clean', { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // par-flat: acc interpretation is a flat string — both flag
  makeNode('par-flat', { accelerationist: 'legacy flat string', safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // par-empty-belief: safetyist has empty belief — both flag
  makeNode('par-empty-belief', { accelerationist: GOOD_ACC, safetyist: { ...GOOD_SAF, belief: '' }, skeptic: GOOD_SKP }),
  // par-sentinel: skp intention = 'tbd' — both flag
  makeNode('par-sentinel', { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: { ...GOOD_SKP, intention: 'tbd' } }),
  // par-multi: acc flat + saf sentinel — both flag (PS: one NonDecomposed entry; TS: two violations)
  makeNode('par-multi', { accelerationist: 'flat', safetyist: { ...GOOD_SAF, desire: 'N/A' }, skeptic: GOOD_SKP }),
  // par-deprecated: [DEPRECATED] prefix — both exempt
  makeNode('par-deprecated', { accelerationist: 'flat', safetyist: 'flat', skeptic: 'flat' }, '[DEPRECATED] Retired.'),
  // par-dep-ws: [DEPRECATED] with leading whitespace — both exempt (trimStart)
  makeNode('par-dep-ws', { accelerationist: 'flat', safetyist: 'flat', skeptic: 'flat' }, '   [DEPRECATED] Leading ws.'),
];

describe('TS↔PS live parity (t/3889)', () => {
  it.skipIf(!pwshAvailable)('TS and PS identify identical failing node IDs over shared fixtures', () => {
    const tsViolatingIds = new Set(findSituationBdiViolations(PARITY_FIXTURES).map(v => v.id));
    const psResult = runPsCheck(PARITY_FIXTURES);
    const psFailingIds = new Set([...psResult.NonDecomposedIds, ...psResult.EmptyIds]);
    // Both should flag exactly: par-flat, par-empty-belief, par-sentinel, par-multi
    expect(tsViolatingIds).toEqual(psFailingIds);
  });

  it.skipIf(!pwshAvailable)('PS exempts both [DEPRECATED] fixtures (Deprecated count = 2)', () => {
    const psResult = runPsCheck(PARITY_FIXTURES);
    expect(psResult.Deprecated).toBe(2);
  });

  it.skipIf(!pwshAvailable)('PS passes the clean node (NonDecomposed + Empty = 0 for clean-only input)', () => {
    const cleanOnly = [makeNode('par-clean', { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: GOOD_SKP })];
    const psResult = runPsCheck(cleanOnly);
    expect(psResult.NonDecomposedIds).toHaveLength(0);
    expect(psResult.EmptyIds).toHaveLength(0);
  });
});
