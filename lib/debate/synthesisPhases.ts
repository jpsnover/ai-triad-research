// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared 3-phase synthesis pipeline: Extract → Map → Evaluate.
 * Decoupled from DebateEngine — usable from both CLI engine and GUI store.
 */

import type { DebateAudience, TrackedCrux } from './types.js';
import {
  synthExtractPrompt,
  synthMapPrompt,
  synthEvaluatePrompt,
} from './prompts.js';
import { formatCruxResolutionContext } from './cruxResolution.js';
import { parseJsonRobust, stripCodeFences, extractArraysFromPartialJson } from './helpers.js';

// ── Types ────────────────────────────────────────────────

export interface SynthesisInput {
  topic: string;
  transcript: string;
  audience?: DebateAudience;
  cruxTracker?: TrackedCrux[];
  /** Policy lines like "pol-001: Ban autonomous weapons". Max 10. */
  policyLines?: string[];
  /** Whether the debate was sourced from a document/URL. */
  hasSourceDoc?: boolean;
}

export type SynthesisGenerateFn = (prompt: string, label: string) => Promise<string>;

export type SynthesisProgressFn = (phase: 1 | 2 | 3, label: string) => void;

export type SynthesisWarnFn = (context: string, problem: string, nextStep: string) => void;

export interface SynthesisPhaseResult {
  /** Merged data from all three phases. */
  data: Record<string, unknown>;
  /** Raw responses keyed by phase for diagnostics. */
  rawResponses: { extract: string; map: string; evaluate: string };
  elapsed_ms: number;
}

// ── Phase runner ─────────────────────────────────────────

function parsePhaseResponse(
  raw: string,
  phaseName: string,
  warn?: SynthesisWarnFn,
): Record<string, unknown> {
  try {
    return parseJsonRobust(raw) as Record<string, unknown>;
  } catch {
    const fallback = extractArraysFromPartialJson(stripCodeFences(raw));
    if (Object.keys(fallback).length === 0) {
      warn?.(
        `Synthesis ${phaseName} parse`,
        `Both JSON parsers returned empty — ${phaseName.toLowerCase()} data will be incomplete`,
        'Proceeding with partial synthesis',
      );
    } else {
      warn?.(
        `Synthesis ${phaseName} parse`,
        'Primary JSON parse failed, recovered partial data via fallback',
        'Synthesis may be incomplete',
      );
    }
    return fallback;
  }
}

/**
 * Run the 3-phase synthesis pipeline: Extract → Map → Evaluate.
 * Pure orchestration — no DebateEngine coupling.
 *
 * @param input - Synthesis context (topic, transcript, audience, etc.)
 * @param generate - LLM call function (prompt, label) → response text
 * @param onProgress - Optional progress callback per phase
 * @param warn - Optional warning callback for parse failures
 * @param checkAborted - Optional abort check (throw to cancel)
 */
export async function runSynthesisPhases(
  input: SynthesisInput,
  generate: SynthesisGenerateFn,
  onProgress?: SynthesisProgressFn,
  warn?: SynthesisWarnFn,
  checkAborted?: () => void,
): Promise<SynthesisPhaseResult> {
  const start = Date.now();
  const data: Record<string, unknown> = {};

  const policyContext = input.policyLines?.length
    ? `\n\n=== POLICY REGISTRY (reference pol-NNN IDs for policy implications) ===\n${input.policyLines.slice(0, 10).join('\n')}`
    : '';

  const cruxContext = (input.cruxTracker?.length ?? 0) > 0
    ? formatCruxResolutionContext(input.cruxTracker!)
    : undefined;

  // Phase 1: Extract core synthesis
  checkAborted?.();
  onProgress?.(1, 'Phase 1/3: Extracting agreements and disagreements');
  const extractRaw = await generate(
    synthExtractPrompt(input.topic, input.transcript, input.audience, cruxContext),
    'Synthesis Phase 1: Extract',
  );
  const extractData = parsePhaseResponse(extractRaw, 'Phase 1', warn);
  if (Object.keys(extractData).length === 0) {
    warn?.('Synthesis Phase 1', 'AI returned empty or unparseable output — synthesis data will be incomplete', 'Proceeding with partial synthesis');
  }
  Object.assign(data, extractData);

  // Phase 2: Build argument map
  checkAborted?.();
  onProgress?.(2, 'Phase 2/3: Building argument map');
  const disagreementsSummary = JSON.stringify(extractData.areas_of_disagreement ?? []);
  const mapRaw = await generate(
    synthMapPrompt(input.topic, input.transcript, disagreementsSummary, input.hasSourceDoc ?? false, input.audience),
    'Synthesis Phase 2: Map',
  );
  const mapData = parsePhaseResponse(mapRaw, 'Phase 2', warn);
  if (Object.keys(mapData).length === 0) {
    warn?.('Synthesis Phase 2', 'AI returned empty or unparseable output — argument map will be incomplete', 'Proceeding with partial synthesis');
  }
  Object.assign(data, mapData);

  // Phase 3: Evaluate preferences + policy implications
  checkAborted?.();
  onProgress?.(3, 'Phase 3/3: Evaluating preferences');
  const argMapSummary = JSON.stringify(mapData.argument_map ?? []);
  const evalRaw = await generate(
    synthEvaluatePrompt(input.topic, disagreementsSummary, argMapSummary, policyContext, input.audience),
    'Synthesis Phase 3: Evaluate',
  );
  const evalData = parsePhaseResponse(evalRaw, 'Phase 3', warn);
  if (Object.keys(evalData).length === 0) {
    warn?.('Synthesis Phase 3', 'AI returned empty or unparseable output — evaluation data will be incomplete', 'Proceeding with partial synthesis');
  }
  Object.assign(data, evalData);

  return {
    data,
    rawResponses: { extract: extractRaw, map: mapRaw, evaluate: evalRaw },
    elapsed_ms: Date.now() - start,
  };
}
