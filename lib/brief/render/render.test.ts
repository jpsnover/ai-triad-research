// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for T4 Render (t/2802): assemble + pptx + HTML targets, presets, parity,
// gate-integrity (no truncate-to-parity), self-contained HTML, CLI arg parsing.

import { describe, it, expect } from 'vitest';
import { render } from './index.js';
import { assemble } from './assemble.js';
import { renderHtml } from './htmlRenderer.js';
import { resolveTheme } from './deckTheme.js';
import { parseArgs } from './cli.js';
import type { DeckSpec, Narration } from '../types.js';

function makeSpec(overrides: Partial<DeckSpec> = {}): DeckSpec {
  return {
    deck_spec_version: '1.0',
    meta: { id: 'sess-1', run_id: 'run-1', title: 'AI Safety Debate', model: 'gemini-pro', protocol: 'structured', phase: 'closed' },
    question: { core_proposition: 'Should AI development be paused?', tensions: ['Safety vs. speed'], time_horizon: '2030' },
    framing_critique: { rating: 'good', composite: 0.8, rewritten_motion: 'Should frontier AI training be paused?' },
    agreements: [{ text: 'Both agree risks are real' }],
    disagreements: [{ text: 'Dispute on imminence', kind: 'EMPIRICAL', resolution_path: 'research' }],
    cruxes: [
      { text: 'Will scaling produce AGI?', kind: 'EMPIRICAL', if_yes: 'pause needed', if_no: 'no pause' },
      { text: 'Is autonomy intrinsically valuable?', kind: 'VALUES', if_yes: 'permit', if_no: 'restrict' },
    ],
    resolution_analysis: {
      stronger_camp_findings: [{ camp: 'saf', finding: 'Evidence favors caution' }],
      would_change_if: [{ camp: 'acc', falsifier: 'A capability plateau is demonstrated' }],
    },
    unresolved_questions: [{ text: 'Timeline uncertainty' }],
    argument_map: { nodes: [], relations: [] },
    fact_checks: [
      { claim: 'AI development is accelerating', verdict: 'Supported', speaker: 'acc' },
      { claim: 'Scaling laws hold indefinitely', verdict: 'Disputed', speaker: 'acc', explanation: 'contested by recent results' },
    ],
    concessions: [
      { camp: 'saf', asserted: 2, conceded: 1, challenged: 0 },
      { camp: 'acc', asserted: 2, conceded: 0, challenged: 1 },
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

function makeNarration(overrides: Partial<Narration> = {}): Narration {
  return {
    deck_spec_version: '1.0',
    narration_mode: 'narrated',
    preset: 'conference',
    narrator_model: 'gemini-2.0-flash',
    narrator_model_source: 'Explicit',
    checker_model: null, checker_model_source: null, checker_passed: null,
    entries: [
      { trace: '/question/core_proposition', text: 'Should we pause frontier AI?', slide: 2 },
      { trace: '/top_claims/0', text: 'Pausing sharply lowers tail risk', slide: 5 },
      { trace: '/top_claims/1', text: 'Pausing forfeits large economic gains', slide: 5 },
    ],
    audience_questions: [
      { trace: '/cruxes/0', question: 'Do you think scaling yields AGI?' },
      { trace: '/question/tensions/0', question: 'How do you weigh safety vs speed?' },
    ],
    ...overrides,
  };
}

describe('render — outputs', () => {
  it('produces pptx bytes (a real zip), HTML, and slide models', async () => {
    const r = await render({ spec: makeSpec(), narration: makeNarration(), preset: 'conference' });
    expect(r.pptxBytes.byteLength).toBeGreaterThan(1000);
    // ZIP local-file magic "PK\x03\x04"
    expect(r.pptxBytes[0]).toBe(0x50);
    expect(r.pptxBytes[1]).toBe(0x4b);
    expect(typeof r.htmlDoc).toBe('string');
    expect(r.htmlDoc).toContain('<!DOCTYPE html');
    expect(r.slideModels.length).toBeGreaterThan(0);
  });
});

describe('render — presets as masks', () => {
  it('conference renders the full 11-slide grammar', async () => {
    const { slides } = assemble(makeSpec(), makeNarration(), 'conference');
    expect(slides.length).toBe(11);
    expect(slides.map(s => s.kind)).toContain('positions');
    expect(slides.map(s => s.kind)).toContain('evidence_shelf');
  });

  it('policymaker is a compressed subset (~6, no legend/positions)', async () => {
    const { slides } = assemble(makeSpec(), makeNarration(), 'policymaker');
    expect(slides.length).toBeLessThanOrEqual(6);
    expect(slides.map(s => s.kind)).not.toContain('how_to_read');
  });

  it('classroom adds framing_meta, glossary, and the open-threads appendix', async () => {
    const kinds = assemble(makeSpec(), makeNarration(), 'classroom').slides.map(s => s.kind);
    expect(kinds).toContain('framing_meta');
    expect(kinds).toContain('glossary');
    expect(kinds).toContain('open_threads_appendix');
  });

  it('framingMeta:false removes framing_meta from classroom (t/2838)', async () => {
    const r = await render({ spec: makeSpec(), narration: makeNarration(), preset: 'classroom', framingMeta: false });
    expect(r.slideModels.map(s => s.kind)).not.toContain('framing_meta');
    expect(r.slideModels.map(s => s.kind)).toContain('glossary'); // other classroom-only slides survive
  });

  it('framingMeta:true (explicit) keeps framing_meta for classroom', async () => {
    const r = await render({ spec: makeSpec(), narration: makeNarration(), preset: 'classroom', framingMeta: true });
    expect(r.slideModels.map(s => s.kind)).toContain('framing_meta');
  });

  it('framingMeta:false on conference/policymaker is a no-op (they never had the slide)', async () => {
    const conf = await render({ spec: makeSpec(), narration: makeNarration(), preset: 'conference', framingMeta: false });
    expect(conf.slideModels.map(s => s.kind)).not.toContain('framing_meta');
    expect(conf.slideModels.length).toBe(11); // count unchanged
  });
});

describe('render — per-camp parity', () => {
  it('the Positions slide has one card per camp', () => {
    const { slides } = assemble(makeSpec(), makeNarration(), 'conference');
    const positions = slides.find(s => s.kind === 'positions')!;
    const cardRow = positions.blocks.find(b => b.type === 'card_row');
    expect(cardRow?.type).toBe('card_row');
    if (cardRow?.type === 'card_row') {
      expect(cardRow.cards.map(c => c.camp).sort()).toEqual(['acc', 'saf']);
    }
  });
});

describe('render — gate integrity (no truncate-to-parity)', () => {
  it('does NOT equalize genuinely asymmetric camp content', () => {
    // saf has a very long claim; acc a short one. Assemble must preserve the
    // asymmetry (so T5 can still fail on real imbalance), not trim saf to match.
    const spec = makeSpec({
      top_claims: [
        { camp: 'saf', claim: 'Pause reduces catastrophic risk because alignment research lags capability by a wide and growing margin across every measured axis', strength: 0.9 },
        { camp: 'acc', claim: 'Pause is costly', strength: 0.8 },
      ],
    });
    // No narrated override for these traces → verbatim spec text flows through.
    const narration = makeNarration({ entries: [] });
    const { slides } = assemble(spec, narration, 'conference');
    const positions = slides.find(s => s.kind === 'positions')!;
    const cardRow = positions.blocks.find(b => b.type === 'card_row');
    if (cardRow?.type === 'card_row') {
      const saf = cardRow.cards.find(c => c.camp === 'saf')!.lines.join(' ');
      const acc = cardRow.cards.find(c => c.camp === 'acc')!.lines.join(' ');
      expect(saf.split(/\s+/).length).toBeGreaterThan(acc.split(/\s+/).length * 2);
    }
  });
});

describe('render — speaker notes reuse the narration trace', () => {
  it('carries the entry’s own resolvable pointer, not a fabricated one', () => {
    const { slides } = assemble(makeSpec(), makeNarration(), 'conference');
    const positions = slides.find(s => s.kind === 'positions')!;
    const traces = positions.speakerNotes.map(n => n.trace);
    expect(traces).toContain('/top_claims/0');
    expect(traces).toContain('/top_claims/1');
  });
});

describe('render — self-contained HTML', () => {
  it('has inline styles and no external network references', async () => {
    const { slides } = assemble(makeSpec(), makeNarration(), 'conference');
    const { theme } = await resolveTheme();
    const html = renderHtml(slides, theme);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/@import/);
  });

  it('escapes HTML in dynamic content (XSS-safe, deterministic)', async () => {
    const spec = makeSpec({ question: { core_proposition: 'Pause <script>alert(1)</script>?' } });
    const { slides } = assemble(spec, makeNarration({ entries: [] }), 'conference');
    const { theme } = await resolveTheme();
    const html = renderHtml(slides, theme);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('render — snapshot watermark + template disclosure', () => {
  it('marks slides with the IN PROGRESS watermark when meta.snapshot is set', () => {
    const spec = makeSpec({ meta: { id: 'x', run_id: 'r', title: 't', model: 'm', protocol: 'p', phase: 'open', snapshot: true } });
    const { slides } = assemble(spec, makeNarration(), 'conference');
    expect(slides.every(s => s.watermark === 'IN PROGRESS')).toBe(true);
  });

  it('records a template_parse_error warning when invalid .potx bytes are supplied', async () => {
    const r = await render({ spec: makeSpec(), narration: makeNarration(), preset: 'conference', template: new Uint8Array([1, 2, 3]) });
    expect(r.warnings.some(w => w.startsWith('template_parse_error'))).toBe(true);
  });
});

describe('render — graceful empty (ADR-001)', () => {
  it('omits the change_minds falsifier sub-block when would_change_if is empty but still renders concessions', () => {
    const spec = makeSpec({ resolution_analysis: { stronger_camp_findings: [{ camp: 'saf', finding: 'x' }] } });
    const { slides } = assemble(spec, makeNarration(), 'conference');
    const cm = slides.find(s => s.kind === 'change_minds');
    expect(cm).toBeDefined();
    expect(cm!.blocks.some(b => b.type === 'table')).toBe(true);
  });
});

describe('render — CLI arg parsing', () => {
  it('parses spec/narration/preset/out and the --pdf flag', () => {
    const args = parseArgs(['--spec', 'a.json', '--narration', 'b.json', '--preset', 'classroom', '--out', 'x.pptx', '--pdf']);
    expect(args).toEqual({ spec: 'a.json', narration: 'b.json', preset: 'classroom', out: 'x.pptx', pdf: true });
  });

  it('defaults preset to conference and out to ./brief.pptx', () => {
    const args = parseArgs(['--spec', 'a.json', '--narration', 'b.json']);
    expect(args.preset).toBe('conference');
    expect(args.out).toBe('./brief.pptx');
    expect(args.pdf).toBe(false);
  });

  it('throws on unknown preset', () => {
    expect(() => parseArgs(['--spec', 'a.json', '--narration', 'b.json', '--preset', 'bogus'])).toThrow();
  });
});
