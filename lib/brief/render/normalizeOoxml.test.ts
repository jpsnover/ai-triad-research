// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the ppt/presentation.xml canonical-order fix (t/2871).
//   1. Pure unit tests of the reorder logic.
//   2. Red-first render→verify-WITH-notes integration test — the exact #1256 gate
//      gap (no test ever rendered a deck with speaker notes through verify), which
//      is why the pptxgenjs ordering bug stayed latent.

import { describe, it, expect } from 'vitest';
import { reorderPresentationChildren } from './normalizeOoxml.js';
import { runBriefPipeline } from '../pipeline.js';
import type { DebateSession } from '../../debate/types.js';
import type { AIAdapter } from '../../debate/aiAdapter.js';

// pptxgenjs's buggy shape: <p:sldIdLst> BEFORE <p:notesMasterIdLst>.
const OUT_OF_ORDER = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" saveSubsetFonts="1">',
  '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>',
  '<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>',
  '<p:notesMasterIdLst><p:notesMasterId r:id="rId4"/></p:notesMasterIdLst>',
  '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>',
  '<p:notesSz cx="6858000" cy="9144000"/>',
  '<p:defaultTextStyle><a:lvl1pPr/></p:defaultTextStyle>',
  '</p:presentation>',
].join('');

const CANONICAL_TAGS = ['sldMasterIdLst', 'notesMasterIdLst', 'handoutMasterIdLst', 'sldIdLst', 'sldSz', 'notesSz'];
function orderedPositions(xml: string): string[] {
  return CANONICAL_TAGS
    .map(t => ({ t, at: xml.indexOf(`<p:${t}`) }))
    .filter(p => p.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(p => p.t);
}

describe('reorderPresentationChildren', () => {
  it('moves notesMasterIdLst before sldIdLst (the pptxgenjs defect)', () => {
    const out = reorderPresentationChildren(OUT_OF_ORDER);
    expect(orderedPositions(out)).toEqual(['sldMasterIdLst', 'notesMasterIdLst', 'sldIdLst', 'sldSz', 'notesSz']);
    // notesMasterIdLst now precedes sldIdLst
    expect(out.indexOf('<p:notesMasterIdLst')).toBeLessThan(out.indexOf('<p:sldIdLst'));
  });

  it('preserves each element\'s children and any trailing non-canonical elements', () => {
    const out = reorderPresentationChildren(OUT_OF_ORDER);
    expect(out).toContain('<p:sldId id="256" r:id="rId2"/>');
    expect(out).toContain('<p:sldId id="257" r:id="rId3"/>');
    expect(out).toContain('<p:notesMasterId r:id="rId4"/>');
    // defaultTextStyle stays after the id-lists/sizes
    expect(out.indexOf('<p:defaultTextStyle')).toBeGreaterThan(out.indexOf('<p:notesSz'));
    // no element dropped or duplicated
    for (const tag of ['sldMasterIdLst', 'notesMasterIdLst', 'sldIdLst', 'sldSz', 'notesSz', 'defaultTextStyle']) {
      expect(out.split(`<p:${tag}`).length - 1, `${tag} count`).toBe(1);
    }
  });

  it('is a no-op (returns the same string) when already canonical', () => {
    const already = reorderPresentationChildren(OUT_OF_ORDER);
    expect(reorderPresentationChildren(already)).toBe(already);
  });

  it('leaves XML with fewer than two canonical children untouched', () => {
    const one = '<p:presentation><p:sldIdLst><p:sldId id="256"/></p:sldIdLst></p:presentation>';
    expect(reorderPresentationChildren(one)).toBe(one);
  });
});

// ── Red-first render→verify-WITH-notes (the #1256 gate gap) ───────────────────

const guardAdapter = { generateText: async () => { throw new Error('adapter must not be called under skipNarration'); } } as AIAdapter;

// Minimal valid CLOSED session — the deterministic pipeline attaches speaker notes to
// every slide, which is what triggers pptxgenjs's notesMaster ordering bug.
function makeSession(): DebateSession {
  return {
    id: 'sess-ooxml-001', run_id: 'run-ooxml-001', title: 'Should AI safety be legally mandated?',
    debate_model: 'claude-sonnet-5', protocol_id: 'structured', phase: 'closed',
    topic: {
      final: 'AI safety requirements should be legally mandated',
      scope: { key_tensions: ['innovation vs. safety'], explicit_qualifiers: ['frontier models'], excluded_scenarios: ['research prototypes'], time_horizon: '2026-2030' },
      critique: { rating: 'fair', composite_score: 12, reframing_suggestion: 'Should frontier AI training require certified safety audits?' },
    },
    transcript: [{
      type: 'concluding',
      metadata: { synthesis: {
        areas_of_agreement: [{ point: 'AI risks are real', povers: ['acc', 'saf'] }],
        areas_of_disagreement: [{ point: 'Mandatory thresholds are harmful', bdi_layer: 'belief', resolvability: 'empirically_testable' }],
        unresolved_questions: ['What metrics define sufficient safety?'],
        cruxes: [{ question: 'Will mandates stifle innovation?', type: 'EMPIRICAL', if_yes: 'Acc wins', if_no: 'Saf wins', resolution_status: 'active' }],
        preferences: [{ conflict: 'speed vs. safety', prevails: 'saf', criterion: 'public harm', rationale: 'irreversible harms outweigh delay costs', what_would_change_this: 'proof mandates cut investment >30%' }],
        argument_map: [{ claim_id: 'a1', claim: 'Regulation reduces innovation', claimant: 'acc', supported_by: ['a2'], attacked_by: [{ claim_id: 'a3' }] }],
      } },
    }],
    argument_network: { nodes: [
      { id: 'a1', text: 'Regulation reduces innovation', speaker: 'acc', scoring_method: 'bdi_criteria', computed_strength: 0.72 },
      { id: 'fc1', text: 'Frontier models doubled in 12 months', speaker: 'system', scoring_method: 'fact_check', verification_status: 'supported', verification_evidence: 'Epoch AI 2025' },
    ] },
    commitments: { acc: { asserted: ['c1', 'c2'], conceded: ['c3'], challenged: ['c4'] }, saf: { asserted: ['c6'], conceded: [], challenged: ['c7'] } },
    convergence_tracker: { issues: [{ taxonomy_ref: 'ai-safety-mandate', convergence: 0.4, qbaf_strength: 0.45 }] },
    crux_tracker: [{ id: 'cx1', description: 'Will mandates stifle innovation?', state: 'engaged', identified_turn: 2, history: [], attacking_claim_ids: [], speakers_involved: ['acc', 'saf'], last_computed_strength: 0.5, support_polarity: 0 }],
  } as unknown as DebateSession;
}

describe('render→verify with speaker notes (t/2871 regression)', () => {
  it('a real deck WITH notes passes the verify OOXML canonical-order gate', async () => {
    const result = await runBriefPipeline(
      {
        session: makeSession(), preset: 'policymaker', modelId: 'gemini-2.5-flash', modelSource: 'Explicit',
        skipNarration: true, toolVersions: { 'brief-test': '1.0' }, timestamp: '2026-08-20T00:00:00.000Z',
      },
      guardAdapter,
    );
    // Red-first: on unfixed render this array contains
    //   "ooxml: p:presentation children out of canonical order … <p:sldIdLst> precedes <p:notesMasterIdLst>"
    const canonicalFailures = result.hardFailures.filter(f => /canonical order/i.test(f));
    expect(canonicalFailures, `verify OOXML canonical-order gate failed:\n${result.hardFailures.join('\n')}`).toEqual([]);
    // And the export is fully clean (no other hard failures) → the CLI/server success path works.
    expect(result.hardFailures).toEqual([]);
  }, 60_000);
});
