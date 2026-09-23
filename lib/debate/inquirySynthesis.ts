// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * LLM synthesis pass for the "Ask a question" inquiry pipeline (t/3580).
 * Turns a completed DebateSession + grounding/calibration/derivation into a
 * validated InquiryResult via a single evaluator-model call.
 *
 * Caller contract (ADR-0002 §2): builds on a COMPLETED session only.
 * Consumer: runInquiryPipeline (t/3585).
 */

import type { DebateSession } from './types/session.js';
import type {
  GroundingEnvelope,
  ResolvedDerivation,
  StoredInquiryRequest,
  InquiryResult,
  CalibrationEntry,
  NodeRef,
  CampVerdict,
  Convergence,
} from '../inquiry/schema.js';
import { INQUIRY_SCHEMA_VERSION } from '../inquiry/schema.js';
import { parseInquiryResult } from '../inquiry/parse.js';
import { ActionableError } from './errors.js';
import { parseAIJson } from './helpers.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { extractTranscriptHighlights, summarizeArgumentNetwork } from './newsReport.js';
import {
  inquirySynthesisPrompt,
  formatGroundingContext,
  SINGLE_RUN_CAVEAT,
} from './prompts/inquiry.js';
import type { AIAdapter } from './aiAdapter.js';

// ── LLM output shape ──────────────────────────────────────────────────────────
// The LLM returns node IDs, not full NodeRef objects. We resolve labels from the
// grounding snapshot after parsing (node labels may have changed since debate setup).

interface LlmCampVerdict {
  camp: string;
  verdict: string;
  nodeIds?: string[];
}

interface LlmConvergence {
  claim: string;
  nodeIds?: string[];
}

interface LlmEvidenceLayer {
  title: string;
  role: string;
  solves: string;
  sources: string[];
}

interface LlmUnresolvedGap {
  description: string;
  confidence: string;
}

interface LlmSynthesisOutput {
  campVerdicts: LlmCampVerdict[];
  convergences: LlmConvergence[];
  evidenceLayers: LlmEvidenceLayer[];
  unresolvedGaps: LlmUnresolvedGap[];
  singleRunCaveat?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function warn(message: string): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'inquirySynthesis',
    level: 'warn',
    message,
  });
}

/** Build a flat lookup map nodeId → NodeRef from the grounding snapshot. */
function buildNodeRefMap(grounding: GroundingEnvelope): Map<string, NodeRef> {
  const map = new Map<string, NodeRef>();
  for (const refs of Object.values(grounding.nodesByCamp)) {
    for (const ref of refs ?? []) {
      map.set(ref.nodeId, ref);
    }
  }
  return map;
}

/**
 * Resolve node IDs to grounding-snapshot NodeRefs.
 * IDs not in the snapshot are dropped with a warn — the LLM may hallucinate IDs that
 * were never in the prompt context.
 */
function resolveNodeRefs(nodeIds: string[], nodeRefMap: Map<string, NodeRef>): NodeRef[] {
  const resolved: NodeRef[] = [];
  for (const id of nodeIds) {
    const ref = nodeRefMap.get(id);
    if (!ref) {
      warn(`synthesizeInquiry: nodeId '${id}' not in grounding snapshot — dropped`);
      continue;
    }
    resolved.push(ref);
  }
  return resolved;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the LLM synthesis pass for an inquiry and return a validated InquiryResult.
 *
 * @param session    Completed debate session (transcript + argument network).
 * @param grounding  Grounding envelope built by buildGroundingEnvelope (t/3577).
 * @param calibration Projected calibration entries built by projectTrust (t/3576).
 * @param derivation  Resolved derivation built by deriveDebateConfig (t/3575).
 * @param request    Stored copy of the original InquiryRequest.
 * @param adapter    AIAdapter for LLM calls.
 */
export async function synthesizeInquiry(
  session: DebateSession,
  grounding: GroundingEnvelope,
  calibration: CalibrationEntry[],
  derivation: ResolvedDerivation,
  request: StoredInquiryRequest,
  adapter: AIAdapter,
): Promise<InquiryResult> {
  // TL t/3580#3 note (1): evaluatorModel must come from derivation, not independently selected.
  const evaluatorModel =
    derivation.models['evaluator'] ?? derivation.models['debaters'] ?? '';

  // 1. Extract debate context for the prompt
  const anNodes = session.argument_network?.nodes ?? [];
  const anEdges = session.argument_network?.edges ?? [];
  const transcriptHighlights = extractTranscriptHighlights(session.transcript ?? [], anNodes);
  const anSummary = summarizeArgumentNetwork(anNodes, anEdges);
  const groundingContext = formatGroundingContext(grounding.nodesByCamp);

  const prompt = inquirySynthesisPrompt(
    request.question,
    transcriptHighlights,
    anSummary,
    groundingContext,
  );

  // 2. LLM call
  const rawText = await adapter.generateText(prompt, evaluatorModel);

  // 3. Parse LLM JSON — t/1626: log bounded payload before throwing on parse failure
  const parsed = parseAIJson<LlmSynthesisOutput>(rawText);
  if (!parsed) {
    const head = rawText.slice(0, 200);
    const tail = rawText.length > 400 ? `…tail: ${rawText.slice(-100)}` : '';
    warn(
      `synthesizeInquiry: parseAIJson returned null — discarded payload head: ${head}${tail ? ` ${tail}` : ''}`,
    );
    throw new ActionableError({
      goal: 'Synthesize inquiry debate into a validated InquiryResult',
      problem: 'LLM response could not be parsed as JSON',
      location: 'lib/debate/inquirySynthesis.synthesizeInquiry',
      nextSteps: [
        'Check flight recorder logs for the raw LLM output head/tail above',
        'Retry the inquiry — intermittent malformed JSON is recoverable',
        'If the model consistently fails, inspect the prompt template in prompts/inquiry.ts',
      ],
    });
  }

  // 4. Resolve node IDs → NodeRef snapshots from grounding (labels baked in at synthesis time)
  const nodeRefMap = buildNodeRefMap(grounding);

  const campVerdicts: CampVerdict[] = (parsed.campVerdicts ?? []).map((cv) => ({
    camp: cv.camp as CampVerdict['camp'],
    verdict: cv.verdict ?? '',
    nodes: resolveNodeRefs(cv.nodeIds ?? [], nodeRefMap),
  }));

  const convergences: Convergence[] = (parsed.convergences ?? []).map((c) => ({
    claim: c.claim ?? '',
    nodes: resolveNodeRefs(c.nodeIds ?? [], nodeRefMap),
  }));

  // 5. Assemble full InquiryResult
  // TL t/3580#3 note (2): singleRunCaveat fallback is the named export from prompts/inquiry.ts
  const assembled = {
    schemaVersion: INQUIRY_SCHEMA_VERSION,
    request,
    campVerdicts,
    convergences,
    evidenceLayers: parsed.evidenceLayers ?? [],
    unresolvedGaps: parsed.unresolvedGaps ?? [],
    singleRunCaveat: parsed.singleRunCaveat || SINGLE_RUN_CAVEAT,
    calibration,
    derivation,
    grounding,
  };

  // 6. Validate through the contract schema — producers go through the same validated
  //    path as consumers so the shape never drifts (TL t/3580#2 design note).
  return parseInquiryResult(assembled);
}
