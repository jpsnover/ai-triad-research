// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateConfig, DebateProgress } from './debateEngine.js';
import { DebateEngine } from './debateEngine.js';
import type { AIAdapter, ExtendedAIAdapter } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type { DebateSession } from './types.js';
import { extractExplorationSummary } from './explorationSummary.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

export const EXPLORATION_PRESET: Partial<DebateConfig> = {
  responseLength: 'brief',
  maxTotalRounds: 8,
  pacing: 'quick',
  enableClarification: false,
  enableWisdomEvaluation: false,
  wisdomAutoReframe: false,
  enableProbing: false,
  temperature: 0.8,
  turnValidation: { maxRetries: 1 },
  protocolId: 'exploration',
};

export interface ExploreFirstResult {
  exploration: DebateSession | null;
  production: DebateSession;
}

export async function runExploreFirstPipeline(
  baseConfig: DebateConfig,
  adapter: AIAdapter | ExtendedAIAdapter,
  taxonomy: LoadedTaxonomy,
  exploreModel: string,
  log: (msg: string) => void,
  onProgress?: (p: DebateProgress) => void,
): Promise<ExploreFirstResult> {
  let explorationSession: DebateSession | null = null;

  try {
    const explorationConfig: DebateConfig = {
      ...baseConfig,
      ...EXPLORATION_PRESET,
      model: exploreModel,
      onSnapshot: undefined,
    };

    log(`Exploration stage: model=${exploreModel}, maxRounds=${explorationConfig.maxTotalRounds}, pacing=${explorationConfig.pacing}`);

    const explorationEngine = new DebateEngine(explorationConfig, adapter, taxonomy);
    explorationSession = await explorationEngine.run((p) => {
      onProgress?.({ ...p, message: `[explore] ${p.message}` });
      log(`[explore] [${p.phase}] ${p.speaker ? `${p.speaker}: ` : ''}${p.message}`);
    });

    const summary = extractExplorationSummary(explorationSession);

    log(`Exploration complete: ${summary.cruxes.length} cruxes, ${summary.argument_sketch.nodes.length} AN nodes, ${summary.effective_situations.length} effective situations`);
    log(`Recommended config: maxRounds=${summary.recommended_config.max_rounds}, pacing=${summary.recommended_config.pacing}, temperature=${summary.recommended_config.temperature}`);

    const productionConfig: DebateConfig = {
      ...baseConfig,
      explorationSummary: summary,
    };

    log(`Production stage: model=${productionConfig.model}, seeded with exploration findings`);

    const productionEngine = new DebateEngine(productionConfig, adapter, taxonomy);
    const productionSession = await productionEngine.run(onProgress);

    return { exploration: explorationSession, production: productionSession };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'explore-first',
      level: 'error',
      message: `Exploration stage failed: ${err instanceof Error ? err.message : String(err)}`,
      error: {
        name: (err as Error).name ?? 'Error',
        message: String(err),
        stack: (err as Error).stack,
      },
    });
    log(`Exploration failed: ${err instanceof Error ? err.message : String(err)} — falling back to blind production run`);

    const productionEngine = new DebateEngine(baseConfig, adapter, taxonomy);
    const productionSession = await productionEngine.run(onProgress);

    return { exploration: explorationSession, production: productionSession };
  }
}
