// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3257 (T2, epic t/3248) — POST /api/taxonomy/relevant-nodes: server-side taxonomy relevance
// selection. The server becomes a SECOND caller of the exact pure fn the client uses
// (lib/debate/relevanceSelection.selectRelevantTaxonomy) — no reimplementation, parity by
// construction — so the debate client no longer fetches the ~400MB synthetic corpus to score
// client-side (the t/3165 architectural fast-follow). The corpus (nodeEmbeddings) is assembled
// server-side via the SHARED lib helper assembleNodeEmbeddings; only tiny per-session state crosses
// the wire up ({nodeId,score}[] + provenance down).
//
// PARITY CONTRACT (the load-bearing gate, → TL GV before the T3 client flip, t/3257#8): given the
// same corpus + session + params, this endpoint's selection === today's client
// getRelevantTaxonomyContext selection (taxonomyContext.ts:363-372), order-preserving. This handler
// mirrors that call site field-for-field. Two embed cbs, each mirroring its client counterpart so the
// vectors are identical BY CONSTRUCTION (t/3257#18/#22):
//   - corpus (assembleNodeEmbeddings)      → BATCH  ai.computeEmbeddings   (client: api.computeEmbeddings)
//   - selectRelevantTaxonomy.embed         → per-text ai.computeQueryEmbedding (client: api.computeQueryEmbedding)

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { log } from '../logger.js';
import * as fileIO from '../storage/fileIO.js';
import * as ai from '../ai/aiBackends.js';
import { POVER_INFO } from '../../../../lib/debate/poverInfo.js';
import {
  selectRelevantTaxonomy,
  assembleNodeEmbeddings,
  type SelectRelevantTaxonomyInput,
  type ANClaimInput,
} from '../../../../lib/debate/relevanceSelection.js';

// The debate speaker's camp — the request `pov` is the full POV file name (matches the client's
// state[pov] read + POVER_INFO.pov). Situations ('cc') nodes are always loaded alongside.
const POV_FILE_KEYS = new Set(['accelerationist', 'safetyist', 'skeptic']);

interface RelevantNodesBody {
  pov: string;
  topic: string;
  recentTranscript: string;
  threshold?: number;
  session?: {
    anClaimEmbeddings?: ANClaimInput[];
    lineageFrame?: { cluster_id: string; label?: string }[];
    sourceType?: string;
    excludeGreatestHits?: boolean;
    greatestHitsList?: string[];
  };
}

/** Corpus embed cb — BATCH, mirrors the client's api.computeEmbeddings (t/3257#22). Same server ONNX
 *  the client's bridge routes to → vector-identical by construction. */
const corpusEmbed = (texts: string[], ids?: string[]): Promise<number[][]> =>
  ai.computeEmbeddings(texts, ids, undefined, { requester: 'relevant-nodes:corpus' }).then(r => r.vectors);

/** Boundary + topic-query embed cb — per-text, mirrors the client's api.computeQueryEmbedding. */
const queryEmbed = (texts: string[]): Promise<number[][]> =>
  Promise.all(texts.map(t => ai.computeQueryEmbedding(t)));

/** Map loadSyntheticEmbeddings() ({pov,vectors}) → the {nodeId: vectors[][]} shape assembleNodeEmbeddings wants. */
function synthVectorsForAssembly(
  synth: Record<string, { pov: string; vectors: number[][] }> | null,
): Record<string, number[][]> | null {
  if (!synth) return null;
  const out: Record<string, number[][]> = {};
  for (const [nodeId, entry] of Object.entries(synth)) out[nodeId] = entry.vectors;
  return out;
}

export function registerRelevantNodesRoutes(r: Router, _ctx: ServerCtx): void {
  const { post } = r;

  post('/api/taxonomy/relevant-nodes', async (_req, res, body) => {
    try {
      const b = (body ?? {}) as RelevantNodesBody;
      const { pov, topic, recentTranscript } = b;
      if (!POV_FILE_KEYS.has(pov)) { error(res, `Invalid or missing pov (expected accelerationist|safetyist|skeptic)`, 400); return; }
      if (typeof topic !== 'string' || typeof recentTranscript !== 'string') { error(res, 'Missing topic/recentTranscript', 400); return; }

      // ── Server-derived (static) — mirrors getRelevantTaxonomyContext's store reads ──
      const povFile = await fileIO.readTaxonomyFile(pov) as { nodes?: SelectRelevantTaxonomyInput['povNodes'] };
      const povNodes = povFile?.nodes ?? [];
      const sitFile = await fileIO.readTaxonomyFile('situations') as { nodes?: SelectRelevantTaxonomyInput['situationNodes'] };
      const situationNodes = sitFile?.nodes ?? [];

      const policyRaw = await fileIO.readPolicyRegistry() as { policies?: { id: string; action: string; source_povs?: string[] }[] } | null;
      const policyRegistry = (policyRaw?.policies ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));

      const lineageRaw = await fileIO.readLineageCategories() as { mapping?: Record<string, { l2: string }> } | null;
      const lineageMapping = lineageRaw?.mapping; // verbatim passthrough (getLineageMapping equivalent, Rosetta p/528)

      const povInfo = Object.values(POVER_INFO).find(i => (i as { pov?: string }).pov === pov) as { doctrinal_boundaries?: string[] } | undefined;
      const doctrinalBoundaries = (povInfo?.doctrinal_boundaries?.length ?? 0) > 0
        ? { strings: povInfo!.doctrinal_boundaries ?? [] }
        : undefined;

      // Corpus map — assembled by the SHARED lib helper (parity by construction), synthetic merge included.
      const synth = synthVectorsForAssembly(await fileIO.loadSyntheticEmbeddings());
      const { nodeEmbeddings } = await assembleNodeEmbeddings(pov, povNodes, situationNodes, corpusEmbed, synth);

      // ── Per-session (from the request body — the server cannot reconstruct these) ──
      const session = {
        anClaimEmbeddings: b.session?.anClaimEmbeddings ?? [],
        lineageFrame: b.session?.lineageFrame,
        sourceType: b.session?.sourceType,
        excludeGreatestHits: b.session?.excludeGreatestHits,
        greatestHitsList: b.session?.greatestHitsList,
      };

      const result = await selectRelevantTaxonomy({
        povNodes, situationNodes, policyRegistry, nodeEmbeddings, lineageMapping, doctrinalBoundaries,
        session,
        params: { pov, topic, recentTranscript, threshold: b.threshold },
        embed: queryEmbed,
      });

      log.api.info(
        { component: 'api', route: 'relevant-nodes', pov, selected: result.povNodes.length, situations: result.situationNodes.length },
        'relevant-nodes served',
      );
      json(res, result); // the full RelevantTaxonomyResult (W1) — client stops recomputing; passes through nodeSourceMap/injectionManifest/anchoring
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to compute relevant nodes',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      log.api.error({ component: 'api', route: 'relevant-nodes', err: String(err) }, 'relevant-nodes failed');
      error(res, String(err), (err as { statusCode?: number }).statusCode ?? 500);
    }
  });
}
