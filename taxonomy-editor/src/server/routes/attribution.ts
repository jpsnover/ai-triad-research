// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3297 — POST /api/argument-network/attribution: server-side per-claim taxonomy attribution.
// The DECOUPLED sibling of /api/taxonomy/relevant-nodes (t/3257). Both score AN claims against the
// SAME ~4144-node corpus, in different phases of a debate turn (relevance pre-turn, attribution
// post-turn extraction). Before this endpoint the client re-derived the corpus locally for
// attribution alone — the last remaining reason it fetched the ~400MB synthetic corpus. Moving
// attribution server-side (a SECOND caller of the exact pure fn — computeClaimTaxonomyAttribution,
// no reimplementation, parity by construction) lets the corpus stay server-only.
//
// PARITY CONTRACT: given the same corpus + speakerPov + claim embeddings, this endpoint's per-claim
// ClaimTaxonomyAttribution === today's client computeClaimTaxonomyAttribution output. The client
// re-applies `attributions[node.id]` to node.claim_taxonomy_attribution verbatim.
//
// The corpus (nodeEmbeddings + povNodes) comes from the shared, main-pinned, process-memoized
// getAssembledCorpus — identical to what relevant-nodes scores against, so relevance and attribution
// can never disagree about which corpus a claim was compared to (the coherence goal, t/3297#9/#10).

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { log } from '../logger.js';
import { getAssembledCorpus } from './corpusAssemblyCache.js';
import { computeClaimTaxonomyAttribution } from '../../../../lib/debate/argumentNetwork/attribution.js';
import type { ArgumentNetworkNode, ClaimTaxonomyAttribution } from '../../../../lib/debate/types.js';

// Same speaker-camp keys as relevant-nodes — the full POV file name.
const POV_FILE_KEYS = new Set(['accelerationist', 'safetyist', 'skeptic']);

/** The minimal claim shape the attribution fn reads (id + one of the two embeddings) plus the field
 *  it writes back. Cast to ArgumentNetworkNode for the pure fn — it touches only these members. */
interface AttributionClaim {
  id: string;
  embedding?: number[];
  attribution_embedding?: number[];
  claim_taxonomy_attribution?: ClaimTaxonomyAttribution;
}

interface AttributionBody {
  pov: string;
  claims: AttributionClaim[];
  topN?: number;
}

export function registerAttributionRoutes(r: Router, _ctx: ServerCtx): void {
  const { post } = r;

  post('/api/argument-network/attribution', async (_req, res, body) => {
    try {
      const b = (body ?? {}) as AttributionBody;
      const { pov } = b;
      if (!POV_FILE_KEYS.has(pov)) { error(res, `Invalid or missing pov (expected accelerationist|safetyist|skeptic)`, 400); return; }
      if (!Array.isArray(b.claims)) { error(res, 'Missing claims (expected array)', 400); return; }

      // ── Corpus (main-pinned + process-memoized): shared with /api/taxonomy/relevant-nodes. ──
      const { nodeEmbeddings, povNodes } = await getAssembledCorpus(pov);

      // Candidate set = all same-POV taxonomy node IDs (all BDI categories) — mirrors the client's
      // allPovNodeIds argument. The fn additionally filters on entry.pov === speakerPov.
      const candidateNodeIds = new Set(povNodes.map(n => n.id));

      const claims = b.claims;
      // Mutates each claim in place (sets claim_taxonomy_attribution); returns a diagnostics summary.
      const summary = computeClaimTaxonomyAttribution(
        claims as unknown as ArgumentNetworkNode[],
        pov,
        nodeEmbeddings,
        candidateNodeIds,
        typeof b.topN === 'number' ? b.topN : undefined,
      );

      // Per-claim attribution the client re-applies verbatim to its AN nodes.
      const attributions: Record<string, ClaimTaxonomyAttribution> = {};
      for (const c of claims) {
        if (c.claim_taxonomy_attribution) attributions[c.id] = c.claim_taxonomy_attribution;
      }

      log.api.info(
        {
          component: 'api', route: 'argument-network/attribution', pov,
          claims: claims.length, attributed: summary.attributed, unattributed: summary.unattributed,
        },
        'attribution served',
      );
      json(res, {
        attributions,
        summary: {
          attributed: summary.attributed,
          unattributed: summary.unattributed,
          missing_embedding: summary.missing_embedding,
          novel_argument: summary.novel_argument,
          // t/3323: per-claim decisions feed the client's ExtractionTimelinePanel
          // (attribution_decisions). Already computed on the ClaimAttributionResult — include, don't drop.
          decisions: summary.decisions,
        },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to compute claim attribution',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      log.api.error({ component: 'api', route: 'argument-network/attribution', err: String(err) }, 'attribution failed');
      error(res, String(err), (err as { statusCode?: number }).statusCode ?? 500);
    }
  });
}
