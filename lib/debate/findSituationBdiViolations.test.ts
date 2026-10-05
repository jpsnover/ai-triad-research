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
import type { SituationNode } from './taxonomyTypes.js';

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

// Probe once at module load — used to emit a clear error (not a skip) when absent.
let pwshAvailable = false;
try {
  execFileSync('pwsh', ['--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  pwshAvailable = true;
} catch {
  // captured below — parity tests fail hard if pwsh is absent
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
// Shared fixtures cover ALL sentinel/exemption/edge cases so both predicates
// are exercised against the full equivalence set (t/3889#4 condition 3).
//
// Parity assertion: TS per-POV detail and PS per-node aggregate agree on the
// set of distinct failing node IDs. Expected: 7 failing, 3 passing, 2 exempt.
//
// These tests FAIL (not skip) when pwsh is absent — condition 1 (t/3889#4).

const PARITY_FIXTURES: SituationNode[] = [
  // ── Passing cases ──────────────────────────────────────
  // Complete BDI with summary
  makeNode('par-complete',    { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // Missing summary — NOT a required field; both predicates pass
  makeNode('par-no-summary',  {
    accelerationist: { belief: GOOD_ACC.belief, desire: GOOD_ACC.desire, intention: GOOD_ACC.intention },
    safetyist: GOOD_SAF, skeptic: GOOD_SKP,
  }),
  // Text that contains a sentinel word but is not a whole-value match — passes
  makeNode('par-non-sentinel', {
    accelerationist: { ...GOOD_ACC, belief: 'none of the above interpretations apply fully' },
    safetyist: GOOD_SAF, skeptic: GOOD_SKP,
  }),
  // ── Failing cases (sentinel / blank) ──────────────────
  // Flat string interpretation
  makeNode('par-flat',         { accelerationist: 'legacy flat string', safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // Whitespace-only belief (trims to empty)
  makeNode('par-whitespace',   { accelerationist: { ...GOOD_ACC, belief: '   ' }, safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // Sentinel "null" (lowercase)
  makeNode('par-sent-null',    { accelerationist: { ...GOOD_ACC, desire: 'null' }, safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // Sentinel "None" (mixed case — OrdinalIgnoreCase)
  makeNode('par-sent-none',    { accelerationist: GOOD_ACC, safetyist: { ...GOOD_SAF, intention: 'None' }, skeptic: GOOD_SKP }),
  // Sentinel "N/A" (uppercase)
  makeNode('par-sent-na',      { accelerationist: GOOD_ACC, safetyist: GOOD_SAF, skeptic: { ...GOOD_SKP, belief: 'N/A' } }),
  // Sentinel "tbd"
  makeNode('par-sent-tbd',     { accelerationist: { ...GOOD_ACC, belief: 'tbd' }, safetyist: GOOD_SAF, skeptic: GOOD_SKP }),
  // Sentinel "-"
  makeNode('par-sent-dash',    { accelerationist: GOOD_ACC, safetyist: { ...GOOD_SAF, desire: '-' }, skeptic: GOOD_SKP }),
  // ── [DEPRECATED] exemption ────────────────────────────
  makeNode('par-deprecated',   { accelerationist: 'flat', safetyist: 'flat', skeptic: 'flat' }, '[DEPRECATED] Retired.'),
  makeNode('par-dep-ws',       { accelerationist: 'flat', safetyist: 'flat', skeptic: 'flat' }, '   [DEPRECATED] Leading ws.'),
];

const EXPECTED_FAILING_IDS = new Set([
  'par-flat', 'par-whitespace',
  'par-sent-null', 'par-sent-none', 'par-sent-na', 'par-sent-tbd', 'par-sent-dash',
]);

describe('TS↔PS live parity (t/3889)', () => {
  it('TS and PS identify identical failing node IDs over shared fixtures', () => {
    if (!pwshAvailable) throw new Error('pwsh required for parity — absent in this environment (CI misconfiguration)');
    const tsViolatingIds = new Set(findSituationBdiViolations(PARITY_FIXTURES).map(v => v.id));
    const psResult = runPsCheck(PARITY_FIXTURES);
    const psFailingIds = new Set([...psResult.NonDecomposedIds, ...psResult.EmptyIds]);
    // Both predicates must agree on the exact failing node set
    expect(tsViolatingIds).toEqual(EXPECTED_FAILING_IDS);
    expect(psFailingIds).toEqual(EXPECTED_FAILING_IDS);
  }, 60_000);

  it('PS exempts both [DEPRECATED] fixtures (Deprecated count = 2)', () => {
    if (!pwshAvailable) throw new Error('pwsh required for parity — absent in this environment (CI misconfiguration)');
    const psResult = runPsCheck(PARITY_FIXTURES);
    expect(psResult.Deprecated).toBe(2);
  }, 60_000);

  it('PS passes the three clean fixtures (Pass count = 3, Fail = 7)', () => {
    if (!pwshAvailable) throw new Error('pwsh required for parity — absent in this environment (CI misconfiguration)');
    const psResult = runPsCheck(PARITY_FIXTURES);
    expect(psResult.Pass).toBe(3);
    expect(psResult.Fail).toBe(7);
  }, 60_000);
});
