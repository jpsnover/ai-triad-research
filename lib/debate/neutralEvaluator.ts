// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Persona-Free Evaluator — independent, neutral reading of debate claims.
 *
 * Reads the debate transcript with persona labels stripped (Speaker A/B/C),
 * no POV taxonomy, no persona descriptions. Produces structured evaluations
 * at three checkpoints (baseline, midpoint, final) for display alongside
 * the persona-grounded synthesis.
 *
 * Design: the evaluator never influences debater behavior, moderator selection,
 * or the synthesis. Users see both views and any divergence between them.
 */

import type { AIAdapter } from './aiAdapter';
import type {
  TranscriptEntry,
  PoverId,
  ContextSummary,
} from './types';
import { POVER_INFO } from './types';
import {
  stripCodeFences,
  parseJsonRobust,
} from './helpers';

// ── Types ─────────────────────────────────────────────────

export type NeutralCheckpoint = 'baseline' | 'midpoint' | 'final';

export interface Crux {
  id: string;
  description: string;
  disagreement_type: 'empirical' | 'values' | 'definitional';
  speakers_involved: string[]; // ['A', 'B'] etc., never persona names
  status: 'addressed' | 'partially_addressed' | 'unaddressed';
  confidence: 'high' | 'medium' | 'low';
}

export interface EvaluatedClaim {
  id: string;
  speaker: string; // 'A' | 'B' | 'C'
  claim_text: string;
  neutral_assessment:
    | 'well_supported'
    | 'plausible_but_underdefended'
    | 'contested_unresolved'
    | 'refuted'
    | 'off_topic';
  reasoning: string; // max 2 sentences
  confidence: 'high' | 'medium' | 'low';
}

export interface NeutralEvaluation {
  checkpoint: NeutralCheckpoint;
  timestamp: string;
  cruxes: Crux[];
  claims: EvaluatedClaim[];
  overall_assessment: {
    strongest_unaddressed_claim_id: string | null;
    debate_is_engaging_real_disagreement: boolean;
    notes: string; // max 3 sentences
  };
  /** Diagnostics: the prompt sent to the LLM (anonymized transcript + instructions). */
  diagnostics_prompt?: string;
  /** Diagnostics: the raw unparsed LLM response before JSON extraction. */
  diagnostics_raw_response?: string;
  /** Diagnostics: LLM response time in milliseconds. */
  diagnostics_response_time_ms?: number;
}

// ── Persona stripping ─────────────────────────────────────

/** Speaker label assignment — randomized per debate to prevent positional bias. */
export interface SpeakerMapping {
  /** Maps PoverId → neutral label ('Speaker A', 'Speaker B', 'Speaker C') */
  forward: Record<string, string>;
  /** Maps neutral label → PoverId (for UI re-attribution) */
  reverse: Record<string, string>;
}

/**
 * Build a randomized speaker mapping. Assignment is shuffled so that
 * 'prometheus' is not always 'Speaker A'.
 */
export function buildSpeakerMapping(activePovers: PoverId[]): SpeakerMapping {
  const labels = ['Speaker A', 'Speaker B', 'Speaker C'];
  // Fisher-Yates shuffle on labels
  const shuffled = [...labels];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const forward: Record<string, string> = {};
  const reverse: Record<string, string> = {};
  const povers = activePovers.filter(p => p !== 'user');
  for (let i = 0; i < povers.length && i < shuffled.length; i++) {
    forward[povers[i]] = shuffled[i];
    reverse[shuffled[i]] = povers[i];
  }

  return { forward, reverse };
}

/** POV labels and persona names to strip from transcript text. */
const PERSONA_TERMS: Record<string, string[]> = {
  prometheus: ['Prometheus', 'accelerationist', 'Accelerationist'],
  sentinel: ['Sentinel', 'safetyist', 'Safetyist'],
  cassandra: ['Cassandra', 'skeptic', 'Skeptic'],
};

/**
 * Strip persona labels from transcript content.
 * Replaces agent names and POV markers with neutral Speaker labels.
 */
function stripPersonaFromText(text: string, mapping: SpeakerMapping): string {
  let result = text;
  for (const [poverId, terms] of Object.entries(PERSONA_TERMS)) {
    const neutralLabel = mapping.forward[poverId];
    if (!neutralLabel) continue;
    for (const term of terms) {
      // Word-boundary replacement to avoid partial matches
      result = result.replace(new RegExp(`\\b${term}\\b`, 'g'), neutralLabel);
    }
  }
  return result;
}

/**
 * Format transcript for the neutral evaluator with all personas stripped.
 * Returns only the debate content — no taxonomy context, no personality descriptions.
 */
export function formatStrippedTranscript(
  transcript: TranscriptEntry[],
  mapping: SpeakerMapping,
  upToIndex?: number,
): string {
  const entries = upToIndex !== undefined
    ? transcript.slice(0, upToIndex + 1)
    : transcript;

  const parts: string[] = [];
  for (const e of entries) {
    // Skip system entries — they may contain POV-specific diagnostics
    if (e.type === 'system') continue;
    // Skip clarification/answer entries — pre-debate setup
    if (e.type === 'clarification' || e.type === 'answer') continue;

    const speaker = e.speaker === 'user'
      ? 'Moderator'
      : mapping.forward[e.speaker] ?? 'Unknown';

    const typeTag = e.type === 'opening' ? ' [opening]'
      : e.type === 'question' ? ' [question]'
      : e.type === 'fact-check' ? ' [fact-check]'
      : '';

    const content = stripPersonaFromText(
      typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
      mapping,
    );

    parts.push(`${speaker}${typeTag}: ${content}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '(No debate content yet)';
}

// ── Evaluator prompt ──────────────────────────────────────

function neutralEvaluatorPrompt(
  checkpoint: NeutralCheckpoint,
  topic: string,
  strippedTranscript: string,
): string {
  const checkpointInstruction =
    checkpoint === 'baseline'
      ? 'This is the BASELINE evaluation after opening statements. Identify the initial positions, core disagreements, and cruxes as they appear at the start.'
      : checkpoint === 'midpoint'
      ? 'This is a MIDPOINT evaluation. Assess whether the debate is engaging the real disagreements or drifting. Compare the current state of claims against what a productive debate on this topic should address.'
      : 'This is the FINAL evaluation at debate conclusion. Produce your definitive assessment of all claims and cruxes.';

  return `You are an independent, neutral evaluator of a structured debate. You have NO affiliation with any speaker. You do not know the speakers' backgrounds, affiliations, or commitments. They are anonymous.

TOPIC: ${topic}

${checkpointInstruction}

INSTRUCTIONS:
1. Identify the CRUXES — the core disagreements that, if resolved, would change one or more speakers' conclusions. For each crux, classify whether it is empirical (resolvable by evidence), values-based (requires tradeoff negotiation), or definitional (requires term clarification). Assess whether the debate has addressed it.

2. Evaluate each substantive CLAIM made by any speaker. Assess it purely on the strength of the reasoning and evidence presented in the transcript — not on whether you agree with it. Use these categories:
   - well_supported: backed by specific evidence, clear reasoning, and not effectively challenged
   - plausible_but_underdefended: reasonable but lacking sufficient evidence or specificity
   - contested_unresolved: challenged by another speaker with neither side prevailing
   - refuted: effectively countered with no adequate response from the claimant
   - off_topic: does not bear on the core debate question

3. In the overall_assessment, identify the single strongest claim that has not been adequately addressed by opposing speakers. State whether the debate is engaging real disagreement (speakers are challenging each other's core reasoning) or performing disagreement (speakers are talking past each other or addressing peripheral points).

CONSTRAINTS:
- Never refer to speakers by anything other than their labels (Speaker A, Speaker B, Speaker C, Moderator).
- Base your assessments ONLY on what appears in the transcript. Do not bring outside knowledge about the topic.
- Keep reasoning fields to 2 sentences maximum.
- Return ONLY valid JSON matching the schema below. No markdown fences, no preamble.

OUTPUT SCHEMA:
{
  "checkpoint": "${checkpoint}",
  "cruxes": [
    {
      "id": "crux-1",
      "description": "The core question the speakers disagree about",
      "disagreement_type": "empirical | values | definitional",
      "speakers_involved": ["A", "B"],
      "status": "addressed | partially_addressed | unaddressed",
      "confidence": "high | medium | low"
    }
  ],
  "claims": [
    {
      "id": "claim-1",
      "speaker": "A | B | C",
      "claim_text": "Near-verbatim claim from the transcript",
      "neutral_assessment": "well_supported | plausible_but_underdefended | contested_unresolved | refuted | off_topic",
      "reasoning": "Max 2 sentences explaining the assessment",
      "confidence": "high | medium | low"
    }
  ],
  "overall_assessment": {
    "strongest_unaddressed_claim_id": "claim-N or null",
    "debate_is_engaging_real_disagreement": true,
    "notes": "Max 3 sentences summarizing the state of the debate from a neutral perspective"
  }
}

TRANSCRIPT:
${strippedTranscript}`;
}

// ── Evaluator runner ──────────────────────────────────────

export interface NeutralEvaluatorConfig {
  adapter: AIAdapter;
  topic: string;
  transcript: TranscriptEntry[];
  contextSummaries?: ContextSummary[];
  activePovers: PoverId[];
  model: string;
  /** Pre-built mapping for consistency across checkpoints within one debate. */
  speakerMapping?: SpeakerMapping;
}

/**
 * Run a single neutral evaluation at the specified checkpoint.
 * Each checkpoint is independent — no memory of prior checkpoints.
 */
export async function runNeutralEvaluation(
  checkpoint: NeutralCheckpoint,
  config: NeutralEvaluatorConfig,
  upToTranscriptIndex?: number,
): Promise<NeutralEvaluation> {
  const mapping = config.speakerMapping ?? buildSpeakerMapping(config.activePovers);
  const strippedTranscript = formatStrippedTranscript(
    config.transcript,
    mapping,
    upToTranscriptIndex,
  );

  const prompt = neutralEvaluatorPrompt(checkpoint, config.topic, strippedTranscript);

  const evaluationSchema = {
    type: 'object',
    properties: {
      checkpoint: { type: 'string', enum: ['baseline', 'midpoint', 'final'] },
      timestamp: { type: 'string' },
      cruxes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            disagreement_type: { type: 'string', enum: ['empirical', 'values', 'definitional'] },
            speakers_involved: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['addressed', 'partially_addressed', 'unaddressed'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['id', 'description', 'disagreement_type', 'speakers_involved', 'status', 'confidence'],
        },
      },
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            speaker: { type: 'string' },
            claim_text: { type: 'string' },
            neutral_assessment: { type: 'string', enum: ['well_supported', 'plausible_but_underdefended', 'contested_unresolved', 'refuted', 'off_topic'] },
            reasoning: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['id', 'speaker', 'claim_text', 'neutral_assessment', 'reasoning', 'confidence'],
        },
      },
      overall_assessment: {
        type: 'object',
        properties: {
          strongest_unaddressed_claim_id: { type: 'string', nullable: true },
          debate_is_engaging_real_disagreement: { type: 'boolean' },
          notes: { type: 'string' },
        },
        required: ['debate_is_engaging_real_disagreement', 'notes'],
      },
    },
    required: ['checkpoint', 'timestamp', 'cruxes', 'claims', 'overall_assessment'],
  };

  const startMs = Date.now();
  const result = await config.adapter.generateText(prompt, config.model, {
    temperature: 0.2,
    maxTokens: 8192,
    responseSchema: evaluationSchema,
  });
  const elapsedMs = Date.now() - startMs;

  const rawText = stripCodeFences(result);
  let parsed: NeutralEvaluation;
  try {
    parsed = parseJsonRobust(rawText) as NeutralEvaluation;
  } catch {
    // Fallback: return a minimal evaluation with the parse error noted
    parsed = {
      checkpoint,
      timestamp: new Date().toISOString(),
      cruxes: [],
      claims: [],
      overall_assessment: {
        strongest_unaddressed_claim_id: null,
        debate_is_engaging_real_disagreement: true,
        notes: `Evaluation parse error. Raw response length: ${rawText.length} chars.`,
      },
    };
  }

  // Ensure checkpoint and timestamp are set correctly regardless of AI output
  parsed.checkpoint = checkpoint;
  parsed.timestamp = new Date().toISOString();

  // Attach diagnostics
  parsed.diagnostics_prompt = prompt;
  parsed.diagnostics_raw_response = rawText;
  parsed.diagnostics_response_time_ms = elapsedMs;

  return parsed;
}

// ── Divergence computation ────────────────────────────────

export interface DivergenceItem {
  type: 'claim_assessment_mismatch' | 'crux_omitted' | 'crux_status_mismatch';
  description: string;
  neutral_view: string;
  synthesis_view: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * Compare the final neutral evaluation against the persona synthesis.
 * Returns items where the two views diverge.
 */
export function computeDivergence(
  neutralEval: NeutralEvaluation,
  synthesisAgreements: { point: string }[],
  synthesisDisagreements: { point: string; positions?: { pover: string; stance: string }[] }[],
  synthesisUnresolved: string[],
): DivergenceItem[] {
  const items: DivergenceItem[] = [];

  // 1. Claims the neutral evaluator marked 'refuted' or 'contested_unresolved'
  //    that don't appear in synthesis disagreements
  for (const claim of neutralEval.claims) {
    if (claim.neutral_assessment === 'refuted' || claim.neutral_assessment === 'contested_unresolved') {
      const claimLower = claim.claim_text.toLowerCase();
      const inDisagreements = synthesisDisagreements.some(
        d => d.point.toLowerCase().includes(claimLower.slice(0, 40)) ||
             claimLower.includes(d.point.toLowerCase().slice(0, 40)),
      );
      const inAgreements = synthesisAgreements.some(
        a => a.point.toLowerCase().includes(claimLower.slice(0, 40)),
      );

      if (inAgreements && !inDisagreements) {
        items.push({
          type: 'claim_assessment_mismatch',
          description: `Synthesis treats as agreed, but neutral evaluator assessed as ${claim.neutral_assessment}`,
          neutral_view: `${claim.claim_text} → ${claim.neutral_assessment}: ${claim.reasoning}`,
          synthesis_view: 'Listed in areas of agreement',
          severity: claim.confidence === 'high' ? 'high' : 'medium',
        });
      }
    }
  }

  // 2. Cruxes the neutral evaluator identified that the synthesis missed entirely
  for (const crux of neutralEval.cruxes) {
    if (crux.status === 'unaddressed' && crux.confidence !== 'low') {
      const cruxLower = crux.description.toLowerCase();
      const inSynthesis =
        synthesisDisagreements.some(d => d.point.toLowerCase().includes(cruxLower.slice(0, 40))) ||
        synthesisUnresolved.some(u => u.toLowerCase().includes(cruxLower.slice(0, 40)));

      if (!inSynthesis) {
        items.push({
          type: 'crux_omitted',
          description: `Neutral evaluator identified an unaddressed crux that the synthesis did not surface`,
          neutral_view: `${crux.description} (${crux.disagreement_type}, ${crux.status})`,
          synthesis_view: 'Not mentioned in disagreements or unresolved questions',
          severity: crux.confidence === 'high' ? 'high' : 'medium',
        });
      }
    }
  }

  // 3. Cruxes where both identified the issue but status differs
  for (const crux of neutralEval.cruxes) {
    if (crux.status === 'unaddressed') {
      const cruxLower = crux.description.toLowerCase();
      const matchedAgreement = synthesisAgreements.find(
        a => a.point.toLowerCase().includes(cruxLower.slice(0, 40)) ||
             cruxLower.includes(a.point.toLowerCase().slice(0, 40)),
      );
      if (matchedAgreement) {
        items.push({
          type: 'crux_status_mismatch',
          description: `Synthesis considers resolved/agreed, but neutral evaluator sees it as unaddressed`,
          neutral_view: `${crux.description} → ${crux.status}`,
          synthesis_view: `Listed as agreement: ${matchedAgreement.point}`,
          severity: 'high',
        });
      }
    }
  }

  return items;
}
