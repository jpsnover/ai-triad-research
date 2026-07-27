// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from './internals.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';

export function seedExplorationSummary(engine: DebateEngineInternals, summary: import('../explorationSummary.js').ExplorationSummary): void {
  if (summary.topic.final !== engine.session.topic.final &&
      summary.topic.original !== engine.config.topic) {
    getGlobalRecorder()?.record({
      type: 'exploration_seeding', component: 'debate-engine', level: 'warn',
      debate_id: engine.session?.id,
      message: 'Exploration summary topic mismatch — skipping seeding',
      data: { summary_topic: summary.topic.final, debate_topic: engine.session.topic.final },
    });
    return;
  }

  // Step 1: Crux seeding — merge exploration cruxes into _priorCruxContext
  const unresolvedCruxes = summary.cruxes.filter(c => c.state !== 'resolved');
  if (unresolvedCruxes.length > 0) {
    const cruxLines = unresolvedCruxes.map(
      c => `- [${c.disagreement_type}] "${c.description}" (${c.state})`,
    );
    const explorationCruxBlock = `\n=== EXPLORATION CRUXES ===\n${cruxLines.join('\n')}`;
    engine._priorCruxContext += explorationCruxBlock;
    getGlobalRecorder()?.record({
      type: 'exploration_seeding', component: 'debate-engine', level: 'info',
      debate_id: engine.session?.id,
      message: `Seeded ${unresolvedCruxes.length} exploration cruxes`,
      data: { step: 'crux_seeding', count: unresolvedCruxes.length },
    });
  }

  // Step 2: Situation pre-filtering — store boost/penalty factors
  for (const sit of summary.effective_situations) {
    engine._explorationBoosts.set(sit.id, 0.15);
  }
  for (const sit of summary.ineffective_situations) {
    engine._explorationBoosts.set(sit.id, -0.10);
  }
  if (engine._explorationBoosts.size > 0) {
    getGlobalRecorder()?.record({
      type: 'exploration_seeding', component: 'debate-engine', level: 'info',
      debate_id: engine.session?.id,
      message: `Seeded ${summary.effective_situations.length} boosts, ${summary.ineffective_situations.length} penalties`,
      data: {
        step: 'situation_filtering',
        boosted: summary.effective_situations.length,
        penalized: summary.ineffective_situations.length,
      },
    });
  }

  // Step 3: AN priming — format argument sketch for Brief prompt injection
  const topNodes = [...summary.argument_sketch.nodes]
    .sort((a, b) => b.computed_strength - a.computed_strength)
    .slice(0, 10);
  const primingParts: string[] = [];
  if (topNodes.length > 0) {
    const nodeLines = topNodes.map(
      n => `- [${n.speaker}] (strength: ${n.computed_strength.toFixed(2)}, refs: ${n.taxonomy_refs.join(', ') || 'none'}): "${n.text}"`,
    );
    const edgeLines = summary.argument_sketch.edges
      .filter(e => {
        const topIds = new Set(topNodes.map(n => n.id));
        return topIds.has(e.source) && topIds.has(e.target);
      })
      .map(e => `  ${e.source} → ${e.type} → ${e.target}${e.attack_type ? ` (${e.attack_type})` : ''}`);
    primingParts.push(
      `=== PRIOR ANALYSIS ===\nThe following argument structure was identified in a prior exploration:\n${nodeLines.join('\n')}` +
      (edgeLines.length > 0 ? `\nKey tensions:\n${edgeLines.join('\n')}` : ''),
    );
    getGlobalRecorder()?.record({
      type: 'exploration_seeding', component: 'debate-engine', level: 'info',
      debate_id: engine.session?.id,
      message: `AN priming: ${topNodes.length} nodes, ${edgeLines.length} edges`,
      data: { step: 'an_priming', nodes: topNodes.length, edges: edgeLines.length },
    });
  }

  // Step 5: Convergence priming — inject agreement/disagreement areas
  const cp = summary.convergence_profile;
  const convergenceLines: string[] = [];
  if (cp.areas_of_agreement.length > 0) {
    convergenceLines.push(`Prior analysis established agreement on:\n${cp.areas_of_agreement.map(a => `- ${a}`).join('\n')}`);
  }
  if (cp.areas_of_disagreement.length > 0) {
    convergenceLines.push(`Disagreement remains on:\n${cp.areas_of_disagreement.map(d => `- ${d}`).join('\n')}`);
  }
  if (cp.unresolved_questions.length > 0) {
    convergenceLines.push(`Open questions to address:\n${cp.unresolved_questions.map(q => `- ${q}`).join('\n')}`);
  }
  if (convergenceLines.length > 0) {
    primingParts.push(
      `=== ESTABLISHED CONTEXT ===\n${convergenceLines.join('\n')}\nDo not re-derive these — build from them.`,
    );
    getGlobalRecorder()?.record({
      type: 'exploration_seeding', component: 'debate-engine', level: 'info',
      debate_id: engine.session?.id,
      message: `Convergence priming: ${cp.areas_of_agreement.length} agreements, ${cp.areas_of_disagreement.length} disagreements, ${cp.unresolved_questions.length} open questions`,
      data: {
        step: 'convergence_priming',
        agreements: cp.areas_of_agreement.length,
        disagreements: cp.areas_of_disagreement.length,
        unresolved: cp.unresolved_questions.length,
      },
    });
  }

  engine._explorationPriming = primingParts.join('\n\n');
}

export function applyExplorationConfigDefaults(engine: DebateEngineInternals): void {
  if (!engine.config.explorationSummary) return;
  const rc = engine.config.explorationSummary.recommended_config;
  if (engine.config.explorationSummary.topic.final !== engine.config.topic &&
      engine.config.explorationSummary.topic.original !== engine.config.topic) {
    return;
  }
  if (engine.config.maxTotalRounds == null) {
    engine.config.maxTotalRounds = Math.min(20, Math.max(6, rc.max_rounds));
  }
  if (engine.config.argumentationExitThreshold == null) {
    engine.config.argumentationExitThreshold = Math.min(0.9, Math.max(0.4, rc.argumentation_exit_threshold));
  }
  if (engine.config.concludingExitThreshold == null) {
    engine.config.concludingExitThreshold = Math.min(0.9, Math.max(0.4, rc.concluding_exit_threshold));
  }
  if (engine.config.temperature == null) {
    engine.config.temperature = Math.min(1.0, Math.max(0.3, rc.temperature));
  }
  if (engine.config.pacing == null) {
    engine.config.pacing = rc.pacing;
  }
  if (engine.config.enableClarification == null && rc.skip_clarification) {
    engine.config.enableClarification = false;
  }
  getGlobalRecorder()?.record({
    type: 'exploration_seeding', component: 'debate-engine', level: 'info',
    debate_id: engine.session?.id,
    message: 'Applied exploration config overrides',
    data: {
      step: 'config_overrides',
      applied: {
        maxTotalRounds: engine.config.maxTotalRounds,
        argumentationExitThreshold: engine.config.argumentationExitThreshold,
        concludingExitThreshold: engine.config.concludingExitThreshold,
        temperature: engine.config.temperature,
        pacing: engine.config.pacing,
        enableClarification: engine.config.enableClarification,
      },
    },
  });
}
