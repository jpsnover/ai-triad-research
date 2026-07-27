// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from './internals.js';

// ── Perturbation testing (HDE B2) ─────────────────────

/** Inject an adversarial perturbation prompt as a system entry. */
export function injectPerturbation(engine: DebateEngineInternals, round: number): void {
  const perturbation = engine.config.perturbation!;
  engine.progress('debate', undefined, `Perturbation injection at round ${round}`);
  const entry = engine.addEntry({
    type: 'system',
    speaker: 'system',
    content: perturbation.prompt,
    taxonomy_refs: [],
    metadata: { perturbation: true, round },
  });
  engine._perturbationEntryId = entry.id;
}

/** Compute SysAR from ArCo signals before and after perturbation injection. */
export function computePerturbationResult(engine: DebateEngineInternals): void {
  const perturbation = engine.config.perturbation;
  if (!perturbation || !engine._perturbationEntryId) return;

  const signals = engine.session.convergence_signals ?? [];
  const injectionRound = perturbation.inject_at_turn;
  const window = perturbation.measure_recovery_window ?? 3;

  // Split signals into pre and post injection
  const preSignals = signals.filter(s => s.round <= injectionRound && s.arco);
  const postSignals = signals.filter(s => s.round > injectionRound && s.round <= injectionRound + window && s.arco);

  const preArco = preSignals.length > 0
    ? preSignals.reduce((sum, s) => sum + s.arco!.turn_similarity, 0) / preSignals.length
    : 0.5; // Default baseline if no pre-injection ArCo available
  const postArco = postSignals.length > 0
    ? postSignals.reduce((sum, s) => sum + s.arco!.turn_similarity, 0) / postSignals.length
    : 0;
  const sysar = preArco > 0 ? postArco / preArco : 0;

  engine.session.perturbation_result = {
    prompt: perturbation.prompt,
    injected_at_round: injectionRound,
    injection_entry_id: engine._perturbationEntryId,
    pre_arco: preArco,
    post_arco: postArco,
    sysar,
    recovery_window: postSignals.length,
    resilient: sysar >= 0.8,
  };
}
