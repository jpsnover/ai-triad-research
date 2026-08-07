// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useFlag } from '../../hooks/useFeatureFlags';
import { PhaseProgressBar, SessionPhaseStepper, UnifiedPhaseIndicator } from './DebateActionBar';
import type { AdaptivePhase } from './utils';

interface AdaptiveStaging {
  enabled: boolean;
  current_phase: AdaptivePhase;
  phase_progress: number;
  rounds_in_phase: number;
  approaching_transition: boolean;
  rationale?: string;
}

/**
 * Phase indicators for the debate workspace header. Behind `DEBATE_CHAT_REDESIGN`
 * the two previously-stacked scales collapse into one {@link UnifiedPhaseIndicator}
 * that nests the adaptive stage inside the Debate step (t/2238); with the flag off
 * the original {@link SessionPhaseStepper} + {@link PhaseProgressBar} render exactly
 * as before.
 */
export function DebatePhaseIndicators({ activeDebate, isDebatePhase }: {
  activeDebate: { phase: string; transcript: { type: string }[] };
  isDebatePhase: boolean;
}) {
  const chatRedesign = useFlag('DEBATE_CHAT_REDESIGN');
  const staging = (activeDebate as any).adaptive_staging as AdaptiveStaging | undefined;

  // Session stepper is visible once the debate has started; the adaptive stage only
  // during an active debate phase with staging enabled (t/1027 hide-when-closed rules).
  const showSessionPhase = activeDebate.phase !== 'setup' && activeDebate.phase !== 'closed';
  const showAdaptivePhase = isDebatePhase && activeDebate.phase !== 'closed' && !!staging?.enabled;
  const roundCount = activeDebate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length;
  const adaptive = showAdaptivePhase && staging ? {
    currentPhase: staging.current_phase || 'confrontation',
    phaseProgress: staging.phase_progress || 0,
    roundsInPhase: staging.rounds_in_phase || 0,
    approachingTransition: staging.approaching_transition || false,
    rationale: staging.rationale,
  } : undefined;

  if (chatRedesign) {
    if (!showSessionPhase) return null;
    return <UnifiedPhaseIndicator phase={activeDebate.phase} roundCount={roundCount} adaptive={adaptive} />;
  }

  return (
    <>
      {showSessionPhase && (
        <SessionPhaseStepper phase={activeDebate.phase} roundCount={roundCount} />
      )}
      {adaptive && (
        <PhaseProgressBar
          currentPhase={adaptive.currentPhase}
          phaseProgress={adaptive.phaseProgress}
          roundsInPhase={adaptive.roundsInPhase}
          approachingTransition={adaptive.approachingTransition}
          rationale={adaptive.rationale}
        />
      )}
    </>
  );
}
