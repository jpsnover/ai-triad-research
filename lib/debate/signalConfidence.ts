// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Confidence gating for the adaptive staging signal system.
 *
 * Prevents noisy extraction from triggering spurious phase transitions
 * by computing layered confidence scores and deferring decisions when
 * confidence falls below the floor.
 */

/** Default threshold below which a signal is deferred. */
export const DEFAULT_CONFIDENCE_FLOOR = 0.40;

/**
 * Score the reliability of the extraction pipeline for a single turn.
 *
 * @param extractionStatus  'ok' | 'truncated' | 'parse_error' (or any other string → 0)
 * @param claimsAccepted    Number of claims the validator accepted
 * @param categoryValidityRatio  Fraction of categories that mapped to known values [0, 1]
 * @returns Confidence in [0, 1]
 */
export function computeExtractionConfidence(
  extractionStatus: string,
  claimsAccepted: number,
  categoryValidityRatio: number,
): number {
  let statusScore: number;
  switch (extractionStatus) {
    case 'ok':          statusScore = 1.0; break;
    case 'truncated':   statusScore = 0.5; break;
    case 'parse_error': statusScore = 0.0; break;
    default:            statusScore = 0.0; break;
  }

  const claimsComponent = Math.min(1, claimsAccepted / 2);

  return 0.5 * statusScore
       + 0.3 * claimsComponent
       + 0.2 * categoryValidityRatio;
}

/**
 * Score how stable the current signal value is relative to its recent history.
 *
 * Returns 1.0 (full trust) when there is not enough history (< 3 rounds)
 * or when no moving average is available yet.
 *
 * @param currentValue   The signal value for this round
 * @param movingAvg3     3-round moving average, or null if unavailable
 * @param roundsInPhase  How many rounds have elapsed in the current phase
 * @returns Confidence in [0, 1]
 */
export function computeStabilityConfidence(
  currentValue: number,
  movingAvg3: number | null,
  roundsInPhase: number,
): number {
  if (movingAvg3 === null || roundsInPhase < 3) {
    return 1.0;
  }
  return 1.0 - Math.min(1, Math.abs(currentValue - movingAvg3) / 0.3);
}

/**
 * Combine extraction and stability confidence into one gate value.
 *
 * Uses the minimum so that *either* source of doubt is sufficient
 * to suppress a transition.
 *
 * @returns Confidence in [0, 1]
 */
export function computeGlobalConfidence(
  extractionConfidence: number,
  stabilityConfidence: number,
): number {
  return Math.min(extractionConfidence, stabilityConfidence);
}

/**
 * Decide whether the signal should be deferred (i.e. not acted upon)
 * because confidence is too low.
 *
 * @param globalConfidence  Combined confidence value
 * @param floor             Minimum acceptable confidence (default {@link DEFAULT_CONFIDENCE_FLOOR})
 * @returns `true` if confidence is below the floor
 */
export function isConfidenceDeferred(
  globalConfidence: number,
  floor: number = DEFAULT_CONFIDENCE_FLOOR,
): boolean {
  return globalConfidence < floor;
}
