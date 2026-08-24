// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2883 — end-to-end regression for the narrated-mode camp-completeness fix (B1).
// A narrator that drops a whole camp used to hard-fail verify's presence-symmetry
// arm ("camp X … 0 slides in the narration"), failing the user's export at the
// far-away verify stage. B1: repair re-prompt first, then deterministic backfill
// from the camp's REAL top_claim, surfaced in BOTH an FR event and the export-record
// warnings so the narrator drop signal survives (block→repair-and-warn).
//
// These run the REAL pipeline (extract → narrate → render → verify) with a stub
// adapter, so they exercise the full data path a community-copied debate hits.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBriefPipeline } from './pipeline.js';
import type { AIAdapter } from '../debate/aiAdapter.js';
import { setGlobalRecorder, clearGlobalRecorder } from '../flight-recorder/index.js';

// Full-form camp labels ('accelerationist' …) as seen in the FR (t/2883). Three
// camps, each with a top_claim, mirroring a real closed debate (and a community
// copy, which — proven in the diagnosis — is shape-identical after extract).
function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const camps = ['accelerationist', 'safetyist', 'skeptic'];
  const strength: Record<string, number> = { accelerationist: 0.72, safetyist: 0.71, skeptic: 0.70 };
  return {
    id: 'sess-cc', run_id: 'run-cc', title: 'Should AI safety be legally mandated?',
    debate_model: 'gemini-2.5-flash', protocol_id: 'structured', phase: 'closed',
    topic: {
      final: 'AI safety requirements should be legally mandated',
      scope: { key_tensions: ['innovation vs. safety'] },
      critique: { rating: 'fair', composite_score: 12 },
    },
    transcript: [{
      type: 'concluding',
      metadata: {
        synthesis: {
          areas_of_agreement: [{ point: 'AI risks are real and worth addressing' }],
          areas_of_disagreement: [{ point: 'Mandatory thresholds are net harmful', bdi_layer: 'belief' }],
          unresolved_questions: ['What metrics define sufficient safety?'],
          cruxes: [{ question: 'Will mandates stifle innovation?', type: 'EMPIRICAL', if_yes: 'x', if_no: 'y' }],
          preferences: [],
          argument_map: camps.map(c => ({ claim_id: `am-${c}`, claim: `${c} core argument`, claimant: c, supported_by: [], attacked_by: [] })),
        },
      },
    }],
    argument_network: {
      nodes: camps.map(c => ({
        id: `n-${c}`,
        // Comparable length across camps so the ratio arms stay in tolerance after backfill.
        text: `The ${c} camp position on mandate policy scope`,
        speaker: c,
        scoring_method: 'bdi_criteria',
        computed_strength: strength[c],
      })),
    },
    commitments: Object.fromEntries(camps.map(c => [c, { asserted: ['a'], conceded: [], challenged: [] }])),
    convergence_tracker: { issues: [{ taxonomy_ref: 'ref', convergence: 0.5, qbaf_strength: 0.5 }] },
    crux_tracker: [{ id: 'cx1', description: 'Will mandates stifle innovation?', state: 'engaged' }],
    ...overrides,
  };
}

const META = { toolVersions: { brief: '1.0.0' }, timestamp: '2026-08-20T00:00:00.000Z' };

// Records FR events for the observability assertion (the FR arm of the fix).
interface CapturedEvent { message?: string; data?: Record<string, unknown> }
let events: CapturedEvent[];

beforeEach(() => {
  events = [];
  setGlobalRecorder({ record: (e: CapturedEvent) => events.push(e) } as never);
});
afterEach(() => clearGlobalRecorder());

/** A narrator that covers safetyist + skeptic top_claims but ALWAYS omits
 *  accelerationist — even on the repair retry — so backfill must engage. */
function omitAccelerationistAdapter(): AIAdapter {
  return {
    generateText: vi.fn().mockResolvedValue(JSON.stringify({
      entries: [
        { trace: '/top_claims/1', text: 'The safetyist camp position on mandate policy scope', slide: 1 },
        { trace: '/top_claims/2', text: 'The skeptic camp position on mandate policy scope', slide: 2 },
        { trace: '/agreements/0', text: 'Both sides agree AI risks are real', slide: 3 },
      ],
      audience_questions: [],
    })),
  } as unknown as AIAdapter;
}

describe('t2883 camp backfill — narrated mode drops a camp', () => {
  it('repairs, then backfills the dropped camp from its top_claim → export SUCCEEDS with a warning', async () => {
    const adapter = omitAccelerationistAdapter();
    const res = await runBriefPipeline(
      { session: makeSession() as never, preset: 'conference', modelId: 'gemini-2.5-flash', modelSource: 'Explicit', toolVersions: META.toolVersions, timestamp: META.timestamp },
      adapter,
    );

    // Pass-post: the gate no longer hard-fails (pre-fix this held the symmetry error).
    expect(res.hardFailures).toEqual([]);

    // Presence: accelerationist now has ≥1 slide via the backfill.
    const acc = res.manifest.symmetry.camps.find(c => c.camp === 'accelerationist');
    expect(acc?.slide_count).toBeGreaterThanOrEqual(1);

    // Export-record observability arm: a camp_backfill warning naming the camp.
    expect(res.warnings.some(w => /camp_backfill.*accelerationist/.test(w))).toBe(true);

    // Repair-first: the narrator was re-prompted before backfill kicked in.
    expect((adapter.generateText as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);

    // FR observability arm: a repair event, then the backfill event naming the camp.
    expect(events.some(e => e.data?.reason === 'missing-camp')).toBe(true);
    const bf = events.find(e => e.data?.reason === 'camp-backfill');
    expect(bf).toBeTruthy();
    expect(bf?.data?.backfilledCamps).toContain('accelerationist');
  });

  it('backfill entry traces to the REAL top_claim (never fabricated text)', async () => {
    const res = await runBriefPipeline(
      { session: makeSession() as never, preset: 'conference', modelId: 'gemini-2.5-flash', modelSource: 'Explicit', toolVersions: META.toolVersions, timestamp: META.timestamp },
      omitAccelerationistAdapter(),
    );
    const accClaim = res.spec.top_claims.find(t => t.camp === 'accelerationist')!.claim;
    const backfilled = res.narration.entries.find(e => e.text === accClaim);
    expect(backfilled).toBeTruthy();
    expect(backfilled!.trace).toBe('/top_claims/0'); // accelerationist sorts first by strength
  });
});

describe('t2883 camp backfill — clean narration does not trigger it', () => {
  it('deterministic narration covers every camp → no backfill, no warning, verify passes', async () => {
    const stub = { generateText: vi.fn().mockResolvedValue('{}') } as unknown as AIAdapter;
    const res = await runBriefPipeline(
      { session: makeSession() as never, preset: 'conference', modelId: 'm', modelSource: 'Default', skipNarration: true, toolVersions: META.toolVersions, timestamp: META.timestamp },
      stub,
    );
    expect(res.hardFailures).toEqual([]);
    expect(res.warnings.some(w => /camp_backfill/.test(w))).toBe(false);
    for (const camp of ['accelerationist', 'safetyist', 'skeptic']) {
      expect(res.manifest.symmetry.camps.find(c => c.camp === camp)?.slide_count).toBeGreaterThanOrEqual(1);
    }
    expect(events.some(e => e.data?.reason === 'camp-backfill')).toBe(false);
    // Deterministic mode makes no model call for narration.
    expect((stub.generateText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
