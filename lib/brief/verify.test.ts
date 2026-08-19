// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for T5 Verify & lint gate (t/2803). Both-arms gate verification:
// deliberate defects → hard-fail; clean brief → pass with zero noise.
// Includes the MUST-2 arm: a hard-fail run still emits a schema-valid manifest.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import Ajv from 'ajv';
import { verify } from './verify.js';
import type { VerifyInput } from './verify.js';
import type { DeckSpec, Narration } from './types.js';
import auditManifestSchema from './schemas/audit-manifest.write.json' with { type: 'json' };

const _ajv = new Ajv({ allErrors: true, strict: false });
const _validateManifest = _ajv.compile(auditManifestSchema);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSpec(overrides: Partial<DeckSpec> = {}): DeckSpec {
  return {
    deck_spec_version: '1.0',
    meta: { id: 'sess-1', run_id: 'run-1', title: 'AI Safety Debate', model: 'gemini-pro', protocol: 'structured', phase: 'closed' },
    question: { core_proposition: 'Should AI development be paused?', tensions: ['Safety vs. speed'], qualifiers: [] },
    framing_critique: { rating: 'good', composite: 0.8, rewritten_motion: 'Should frontier AI training be paused?' },
    agreements: [{ text: 'Both agree risks are real' }],
    disagreements: [{ text: 'Dispute on imminence', kind: 'EMPIRICAL', resolution_path: 'empirical research' }],
    cruxes: [{ text: 'Will scaling produce AGI?', kind: 'EMPIRICAL', if_yes: 'pause needed', if_no: 'no pause needed' }],
    resolution_analysis: { stronger_camp_findings: [{ camp: 'saf', finding: 'Evidence favors caution' }] },
    unresolved_questions: [{ text: 'Timeline uncertainty' }],
    argument_map: { nodes: [], relations: [] },
    fact_checks: [
      { claim: 'AI development is accelerating', verdict: 'Supported', speaker: 'acc' },
      { claim: 'Scaling laws hold indefinitely', verdict: 'Disputed', speaker: 'acc' },
    ],
    concessions: [
      { camp: 'saf', asserted: 2, conceded: 1, challenged: 0 },
      { camp: 'acc', asserted: 2, conceded: 1, challenged: 0 },
    ],
    top_claims: [
      { camp: 'saf', claim: 'Pause reduces catastrophic risk substantially', strength: 0.9 },
      { camp: 'acc', claim: 'Pause forfeits enormous economic upside', strength: 0.8 },
    ],
    convergence: [{ issue: 'safety', score: 0.6 }],
    open_threads: [{ text: 'Regulatory pathways' }],
    ...overrides,
  };
}

/** Balanced narration: one entry per camp with equal word budgets and one slide each. */
function makeBalancedNarration(overrides: Partial<Narration> = {}): Narration {
  return {
    deck_spec_version: '1.0',
    narration_mode: 'narrated',
    preset: 'conference',
    narrator_model: 'gemini-2.0-flash',
    narrator_model_source: 'Explicit',
    checker_model: null,
    checker_model_source: null,
    checker_passed: null,
    entries: [
      { trace: '/top_claims/0', text: 'Pausing frontier training sharply lowers tail risk today', slide: 5 },
      { trace: '/top_claims/1', text: 'Pausing frontier training sharply forfeits large economic gains', slide: 5 },
    ],
    audience_questions: [
      { trace: '/question/tensions/0', question: 'How should we weigh safety against speed?' },
    ],
    ...overrides,
  };
}

interface PptxOpts {
  negativeOff?: boolean;
  outOfOrder?: boolean;
  malformedChart?: boolean;
}

async function makePptx(opts: PptxOpts = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');

  const presentation = opts.outOfOrder
    ? '<p:presentation><p:sldSz cx="1" cy="1"/><p:sldMasterIdLst/><p:sldIdLst/><p:notesSz cx="1" cy="1"/></p:presentation>'
    : '<p:presentation><p:sldMasterIdLst/><p:sldIdLst/><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="1" cy="1"/></p:presentation>';
  zip.file('ppt/presentation.xml', presentation);

  const off = opts.negativeOff ? '<a:off x="-5" y="0"/>' : '<a:off x="0" y="0"/>';
  zip.file('ppt/slides/slide1.xml', `<p:sld><p:spPr><a:xfrm>${off}<a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:sld>`);

  if (opts.malformedChart !== undefined) {
    const chart = opts.malformedChart
      ? '<c:chartSpace></c:chartSpace>'
      : '<c:chartSpace><c:chart><c:plotArea/></c:chart></c:chartSpace>';
    zip.file('ppt/charts/chart1.xml', chart);
  }

  return zip.generateAsync({ type: 'uint8array' });
}

async function makeInput(over: Partial<VerifyInput> = {}, pptxOpts: PptxOpts = {}): Promise<VerifyInput> {
  return {
    spec: makeSpec(),
    narration: makeBalancedNarration(),
    pptxBytes: await makePptx(pptxOpts),
    meta: { toolVersions: { 'brief-verify': '1.0.0' }, timestamp: '2026-08-19T17:00:00Z' },
    ...over,
  };
}

// ── Green arm: clean brief passes with zero noise ──────────────────────────────

describe('verify — green arm (clean brief)', () => {
  it('passes with zero hard-failures and zero warnings', async () => {
    const result = await verify(await makeInput());
    expect(result.hardFailures).toEqual([]);
    expect(result.manifest.warnings).toEqual([]);
  });

  it('emits a schema-valid manifest', async () => {
    const result = await verify(await makeInput());
    expect(_validateManifest(result.manifest)).toBe(true);
  });

  it('records real coverage, symmetry, and verdict tallies', async () => {
    const result = await verify(await makeInput());
    expect(result.manifest.trace_coverage_pct).toBe(100);
    expect(result.manifest.symmetry.within_tolerance).toBe(true);
    expect(result.manifest.verdict_counts).toEqual({ Supported: 1, Disputed: 1 });
    expect(result.manifest.symmetry.tolerance_pct).toBe(20);
  });

  it('hashes all three artifacts with sha256', async () => {
    const result = await verify(await makeInput());
    const names = result.manifest.artifacts.map(a => a.name).sort();
    expect(names).toEqual(['brief.pptx', 'deck_spec.json', 'narration.json']);
    for (const a of result.manifest.artifacts) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── Red arm: schema failures ───────────────────────────────────────────────────

describe('verify — schema hard-fails', () => {
  it('hard-fails on invalid deck_spec (missing required section)', async () => {
    const bad = makeSpec();
    delete (bad as Partial<DeckSpec>).cruxes;
    const result = await verify(await makeInput({ spec: bad }));
    expect(result.hardFailures.some(f => f.startsWith('deck_spec schema'))).toBe(true);
  });

  it('hard-fails on invalid narration (bad trace pattern)', async () => {
    const bad = makeBalancedNarration({ entries: [{ trace: 'not-a-pointer', text: 'x', slide: 1 }] });
    const result = await verify(await makeInput({ narration: bad }));
    expect(result.hardFailures.some(f => f.startsWith('narration schema'))).toBe(true);
  });
});

// ── Red arm: trace resolution + coverage ───────────────────────────────────────

describe('verify — trace coverage', () => {
  it('hard-fails on an unresolvable trace', async () => {
    const bad = makeBalancedNarration({
      entries: [{ trace: '/nonexistent/path', text: 'hallucinated', slide: 1 }],
    });
    const result = await verify(await makeInput({ narration: bad }));
    expect(result.hardFailures.some(f => f.startsWith('trace resolution'))).toBe(true);
    expect(result.manifest.trace_coverage_pct).toBeLessThan(100);
  });

  it('skips the coverage==100 gate in deterministic mode', async () => {
    // deterministic mode: all traces resolvable so coverage is 100 here anyway,
    // but the gate must not fire even if narrated-only policy would.
    const det = makeBalancedNarration({ narration_mode: 'deterministic' });
    const result = await verify(await makeInput({ narration: det }));
    expect(result.hardFailures.filter(f => f.startsWith('trace coverage'))).toEqual([]);
  });
});

// ── Red arm: symmetry ──────────────────────────────────────────────────────────

describe('verify — symmetry', () => {
  it('hard-fails when an expected camp has zero slides', async () => {
    // acc appears in the spec but the narration only covers saf.
    const oneCamp = makeBalancedNarration({
      entries: [{ trace: '/top_claims/0', text: 'Pause reduces risk substantially and clearly', slide: 5 }],
    });
    const result = await verify(await makeInput({ narration: oneCamp }));
    expect(result.hardFailures.some(f => f.includes('has 0 slides'))).toBe(true);
    expect(result.manifest.symmetry.within_tolerance).toBe(false);
  });

  it('hard-fails on a word_budget imbalance beyond ±20%', async () => {
    const skewed = makeBalancedNarration({
      entries: [
        { trace: '/top_claims/0', text: 'one two three four five six seven eight nine ten eleven twelve', slide: 5 },
        { trace: '/top_claims/1', text: 'short', slide: 5 },
      ],
    });
    const result = await verify(await makeInput({ narration: skewed }));
    expect(result.hardFailures.some(f => f.includes('word_budget'))).toBe(true);
  });

  it('does NOT false-fire on a 1-vs-2 headline difference (absolute slack)', async () => {
    // saf: 2 entries, acc: 1 entry — headline dev of 0.5 from mean 1.5, within ±1 slack.
    // Keep word budgets balanced so only the headline metric is exercised.
    const nar = makeBalancedNarration({
      entries: [
        { trace: '/top_claims/0', text: 'alpha beta gamma', slide: 5 },
        { trace: '/resolution_analysis/stronger_camp_findings/0', text: 'delta epsilon zeta', slide: 6 },
        { trace: '/top_claims/1', text: 'eta theta iota kappa lambda mu', slide: 5 },
      ],
    });
    const result = await verify(await makeInput({ narration: nar }));
    expect(result.hardFailures.filter(f => f.includes('headline_count'))).toEqual([]);
  });
});

// ── Red arm: OOXML lint ────────────────────────────────────────────────────────

describe('verify — OOXML lint', () => {
  it('hard-fails on a negative a:off value', async () => {
    const result = await verify(await makeInput({}, { negativeOff: true }));
    expect(result.hardFailures.some(f => f.startsWith('ooxml: negative a:off'))).toBe(true);
  });

  it('hard-fails on p:presentation children out of canonical order', async () => {
    const result = await verify(await makeInput({}, { outOfOrder: true }));
    expect(result.hardFailures.some(f => f.includes('out of canonical order'))).toBe(true);
  });

  it('hard-fails on a chart part with chartSpace but no c:chart', async () => {
    const result = await verify(await makeInput({}, { malformedChart: true }));
    expect(result.hardFailures.some(f => f.includes('no <c:chart>'))).toBe(true);
  });

  it('does NOT fail a valid chart part', async () => {
    const result = await verify(await makeInput({}, { malformedChart: false }));
    expect(result.hardFailures.filter(f => f.startsWith('ooxml'))).toEqual([]);
  });
});

// ── MUST 2: hard-fail runs still emit a schema-valid manifest ──────────────────

describe('verify — manifest emitted even on hard-fail (MUST 2)', () => {
  it('returns a schema-valid manifest alongside non-empty hardFailures', async () => {
    const bad = makeBalancedNarration({
      entries: [{ trace: '/nonexistent/path', text: 'hallucinated', slide: 1 }],
    });
    const result = await verify(await makeInput({ narration: bad }));
    expect(result.hardFailures.length).toBeGreaterThan(0);
    expect(_validateManifest(result.manifest)).toBe(true);
    // manifest records reality: the real (sub-100) coverage number
    expect(result.manifest.trace_coverage_pct).toBeLessThan(100);
  });
});

// ── Warnings recorded without failing ──────────────────────────────────────────

describe('verify — warnings (recorded, non-failing)', () => {
  it('records low_convergence / pre_concluding / zero_concession / weak_framing without hard-failing', async () => {
    const spec = makeSpec({
      meta: { id: 'sess-1', run_id: 'run-1', title: 't', model: 'm', protocol: 'p', phase: 'concluding' },
      convergence: [{ issue: 'safety', score: 0.1 }],
      framing_critique: { rating: 'weak', composite: 0.2 },
      concessions: [
        { camp: 'saf', asserted: 2, conceded: 0, challenged: 0 },
        { camp: 'acc', asserted: 2, conceded: 1, challenged: 0 },
      ],
    });
    const result = await verify(await makeInput({ spec }));
    expect(result.hardFailures).toEqual([]);
    const w = result.manifest.warnings.join(' | ');
    expect(w).toContain('low_convergence');
    expect(w).toContain('pre_concluding');
    expect(w).toContain('zero_concession_camp');
    expect(w).toContain('weak_framing');
  });
});
