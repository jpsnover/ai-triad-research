// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from './internals.js';
import { type ExtendedAIAdapter } from '../aiAdapter.js';
import { POVER_INFO, type PovKey } from '../types.js';
import { embedDoctrinalBoundaries, computeDoctrinalAnchoring, checkThresholdAnomalies } from '../doctrinalAnchoring.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';

// ── Doctrinal boundary embedding + anchoring (t/114) ─────

export async function setupDoctrinalAnchoring(engine: DebateEngineInternals): Promise<void> {
  const adapter = engine.adapter as ExtendedAIAdapter;
  if (!adapter.computeQueryEmbedding) return;

  // Collect boundary strings per active POV, separated by type
  const boundaries: Record<string, string[]> = {};
  const boundaryWeights: Record<string, number[]> = {};
  const HARDCODED_WEIGHT = 1.0;
  const SOFTCODED_WEIGHT = 0.7;
  for (const pover of engine.config.activePovers) {
    const info = POVER_INFO[pover];
    if (!info?.boundaries) continue;
    const { hardcoded, softcoded } = info.boundaries;
    const allBoundaries = [...hardcoded, ...softcoded];
    if (allBoundaries.length === 0) continue;
    boundaries[info.pov] = allBoundaries;
    boundaryWeights[info.pov] = [
      ...hardcoded.map(() => HARDCODED_WEIGHT),
      ...softcoded.map(() => SOFTCODED_WEIGHT),
    ];
  }
  if (Object.keys(boundaries).length === 0) return;

  try {
    engine._boundaryEmbeddings = await embedDoctrinalBoundaries(
      boundaries,
      async (text: string) => {
        const { vector } = await adapter.computeQueryEmbedding!(text);
        return vector;
      },
    );
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Boundary embedding failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return;
  }

  // Run anchoring against each POV's Belief nodes
  for (const [pov, vectors] of Object.entries(engine._boundaryEmbeddings)) {
    if (vectors.length === 0) continue;
    const povNodes = engine.taxonomy[pov as PovKey]?.nodes ?? [];
    const beliefs = povNodes.filter(n => n.category === 'Beliefs');
    if (beliefs.length === 0) continue;

    const weights = boundaryWeights[pov];
    const results = computeDoctrinalAnchoring(
      beliefs, vectors, engine.taxonomy.embeddings, weights,
    );

    // Check for threshold anomalies
    const anomaly = checkThresholdAnomalies(results, beliefs.length);
    if (anomaly) console.warn(anomaly.warning);

    const anchoredCount = results.filter(r => r.anchored).length;
    const floorCount = results.filter(r => r.floorApplied).length;
    if (anchoredCount > 0) {
      console.log(`[doctrinal] ${pov}: ${anchoredCount}/${beliefs.length} Beliefs anchored, ${floorCount} floor-applied`);
    }
  }
}
