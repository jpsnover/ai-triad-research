// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3514 — steelman target normalization, verdicts, and the engine validator.
// Regression source: the extraction prompt emitted labels ("Safetyist"), validators looked up
// commitments by id ("safetyist"), so every steelman was skipped silently — 0 checks ever ran.

import { describe, it, expect, vi } from 'vitest';
import { normalizeSteelmanTarget, steelmanVerdict, steelmanTargetLabel, STEELMAN_ENTAILMENT_THRESHOLD } from './steelman.js';
import { processExtractedClaims } from './argumentNetwork.js';
import { validateSteelmans } from './claimExtractionPipeline/gapAndDrift.js';
import type { ClaimExtractionContext } from './claimExtractionPipeline/context.js';
import type { ArgumentNetworkNode } from './types.js';

describe('normalizeSteelmanTarget', () => {
  it.each([
    ['safetyist', 'safetyist'],
    ['Safetyist', 'safetyist'],   // the label the old prompt produced
    ['the Skeptic', 'skeptic'],
    ["Accelerationist's", 'accelerationist'],
    ['Sentinel', 'safetyist'],    // persona name
    ['cassandra', 'skeptic'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeSteelmanTarget(raw, 'accelerationist' === expected ? 'safetyist' : 'accelerationist').target).toBe(expected);
  });

  it('treats empty values as "not a steelman" without flagging them', () => {
    for (const raw of [null, undefined, '', 'null', 'None']) {
      expect(normalizeSteelmanTarget(raw, 'safetyist')).toEqual({ target: null });
    }
  });

  it('rejects claim/document ids seen in production (AN-18, D-7)', () => {
    expect(normalizeSteelmanTarget('AN-18', 'safetyist')).toEqual({ target: null, rejected: 'not_a_camp' });
    expect(normalizeSteelmanTarget('D-7', 'safetyist')).toEqual({ target: null, rejected: 'not_a_camp' });
  });

  it('rejects a debater steelmanning themselves', () => {
    expect(normalizeSteelmanTarget('Safetyist', 'safetyist')).toEqual({ target: null, rejected: 'self_steelman' });
  });
});

describe('steelmanVerdict', () => {
  const said = ['Compute caps are enforceable at the foundry', 'Weights leak through grey markets'];

  it('is faithful when an assertion is entailed at or above the threshold, and reports the best match', () => {
    const v = steelmanVerdict(said, [0.2, STEELMAN_ENTAILMENT_THRESHOLD + 0.1]);
    expect(v).toMatchObject({ verdict: 'faithful', best_match: said[1] });
    expect(v.max_entailment).toBeCloseTo(0.7, 3);
  });

  it('diverges when nothing the target said is entailed', () => {
    expect(steelmanVerdict(said, [0.1, 0.3])).toMatchObject({ verdict: 'diverges', max_entailment: 0.3, best_match: said[1] });
  });

  it('is unchecked when the target has asserted nothing, or NLI returned nothing', () => {
    expect(steelmanVerdict([], [])).toMatchObject({ verdict: 'unchecked' });
    expect(steelmanVerdict(said, [])).toMatchObject({ verdict: 'unchecked', reason: 'NLI returned no results' });
  });
});

describe('steelmanTargetLabel', () => {
  it('labels ids and legacy labels, and hides junk', () => {
    const label = (c: string) => c.toUpperCase();
    expect(steelmanTargetLabel('safetyist', label)).toBe('SAFETYIST');
    expect(steelmanTargetLabel('Safetyist', label)).toBe('SAFETYIST');
    expect(steelmanTargetLabel('AN-18', label)).toBeNull();
    expect(steelmanTargetLabel(undefined, label)).toBeNull();
  });
});

describe('processExtractedClaims — steelman_of normalized at ingestion', () => {
  const base = {
    statement: 'Foundry-level compute caps can be enforced without domestic surveillance of model weights at all',
    speaker: 'accelerationist',
    entryId: 'entry-3',
    taxonomyRefIds: [],
    turnNumber: 3,
    existingNodes: [] as ArgumentNetworkNode[],
    existingEdgeCount: 0,
    startNodeId: 1,
  };
  const opts = { groundingOverlapThreshold: 0.1, isClassifyPath: false };

  it('stores a label as the camp id', async () => {
    const r = await processExtractedClaims({ ...base, claims: [{ text: base.statement, bdi_category: 'belief', steelman_of: 'Safetyist' }] }, opts);
    expect(r.newNodes[0].steelman_of).toBe('safetyist');
  });

  it('drops a non-camp value instead of storing it', async () => {
    const r = await processExtractedClaims({ ...base, claims: [{ text: base.statement, bdi_category: 'belief', steelman_of: 'AN-18' }] }, opts);
    expect(r.newNodes[0].steelman_of).toBeUndefined();
  });
});

describe('validateSteelmans (engine path)', () => {
  const steelman = (steelman_of: string): ArgumentNetworkNode => ({
    id: 'AN-26', text: 'ASML and TSMC can gate foundational silicon at the lithography level', speaker: 'accelerationist',
    source_entry_id: 'e1', taxonomy_refs: [], turn_number: 4, steelman_of,
  } as ArgumentNetworkNode);

  function ctx(nli?: (pairs: unknown[]) => Promise<{ results: { nli_entailment: number }[] }>, asserted = ['Foundries are a natural chokepoint for compute governance']) {
    const addEntry = vi.fn().mockReturnValue({ id: 'sys-1' });
    return {
      addEntry,
      c: {
        adapter: nli ? { nliClassify: nli } : {},
        session: { id: 'd1', commitments: { safetyist: { asserted, conceded: [], challenged: [] } } },
        addEntry,
        recordDiagnostic: vi.fn(),
        warn: vi.fn(),
      } as unknown as ClaimExtractionContext,
    };
  }

  it('now checks a legacy-label steelman (previously skipped) and persists a faithful verdict', async () => {
    const node = steelman('Safetyist');
    const { c, addEntry } = ctx(async () => ({ results: [{ nli_entailment: 0.82 }] }));
    await validateSteelmans(c, [node], 'accelerationist');
    expect(node.steelman_check).toMatchObject({ verdict: 'faithful', max_entailment: 0.82 });
    expect(addEntry).not.toHaveBeenCalled();
  });

  it('persists a diverges verdict and posts the [Steelman check] warning', async () => {
    const node = steelman('safetyist');
    const { c, addEntry } = ctx(async () => ({ results: [{ nli_entailment: 0.12 }] }));
    await validateSteelmans(c, [node], 'accelerationist');
    expect(node.steelman_check?.verdict).toBe('diverges');
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('[Steelman check]') }));
  });

  it('records why a steelman could not be checked instead of skipping silently', async () => {
    const noNli = steelman('safetyist');
    await validateSteelmans(ctx(undefined).c, [noNli], 'accelerationist');
    expect(noNli.steelman_check).toMatchObject({ verdict: 'unchecked', reason: 'NLI not available on this adapter' });

    const noAssertions = steelman('safetyist');
    await validateSteelmans(ctx(async () => ({ results: [] }), []).c, [noAssertions], 'accelerationist');
    expect(noAssertions.steelman_check).toMatchObject({ verdict: 'unchecked', reason: 'Target has no recorded assertions yet' });
  });
});
