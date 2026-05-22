// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Topic critique: pre-debate quality gate for wisdom-generating topics.
 *
 * Two-phase scoring based on research/comp-linguist/wisdom-generating-topics.md:
 * - Phase A (structural): deterministic scoring from taxonomy embeddings + evidence index
 * - Phase B (frame): single LLM call scoring linguistic/frame properties
 *
 * 20-point rubric (10 structural + 10 frame). Ratings:
 * - Strong (14+): auto-proceed
 * - Fair (8-13): show expanded suggestions
 * - Weak (0-7): show rewritten topic prominently
 *
 * Run once before clarification, free-form topics only.
 */

import { cosineSimilarity } from './taxonomyRelevance.js';
import type { PovNode, SituationNode, Category } from './taxonomyTypes.js';
import type { SourceEvidenceIndex } from './evidenceFromSummaries.js';

// ── Types ─────────────────────────────────────────────────

export interface TopicIssue {
  /** Which scoring dimension flagged this issue. */
  dimension: string;
  /** Severity level. */
  severity: 'low' | 'medium' | 'high';
  /** Human-readable description of the problem. */
  description: string;
  /** Actionable suggestion to fix it. */
  suggestion: string;
}

export interface ReframeSuggestion {
  /** Which frame dimension this addresses. */
  dimension: 'conditionality' | 'mechanism' | 'stakeholder' | 'tension' | 'scope';
  /** What's weak about the current frame. */
  original_weakness: string;
  /** Suggested replacement fragment or full reframe. */
  reframed_fragment: string;
}

export interface StructuralScore {
  /** POV balance of activated nodes (0/1/2). */
  crux_density: 0 | 1 | 2;
  /** Fraction of activated nodes with evidence entries (0/1/2). */
  evidence_coverage: 0 | 1 | 2;
  /** Balance across BDI categories (0/1/2). */
  bdi_heterogeneity: 0 | 1 | 2;
  /** Node count per POV in the Goldilocks zone (0/1/2). */
  abstraction_level: 0 | 1 | 2;
  /** Situation/cross-cutting node activation count (0/1/2). */
  situation_activation: 0 | 1 | 2;
  /** Sum of all structural dimensions (0-10). */
  total: number;
  /** Nodes activated above the similarity threshold, with scores. */
  activated_nodes: { id: string; similarity: number; pov?: string; category?: string }[];
  /** Per-POV activation counts. */
  pov_distribution: Record<string, number>;
  /** Per-BDI category activation counts. */
  bdi_distribution: Record<string, number>;
}

export interface FrameScore {
  /** Conditionality: binary (0) → partial (1) → fully conditional (2). */
  conditionality: 0 | 1 | 2;
  /** Mechanism focus: outcome-only (0) → mixed (1) → mechanism-first (2). */
  mechanism: 0 | 1 | 2;
  /** Stakeholder breadth: single actor (0) → two (1) → multiple (2). */
  stakeholder: 0 | 1 | 2;
  /** Tension acknowledgment: neutral (0) → implied (1) → named + meta-invitation (2). */
  tension: 0 | 1 | 2;
  /** Scope boundedness: open-ended (0) → partial (1) → concrete artifacts (2). */
  scope: 0 | 1 | 2;
  /** Sum of all frame dimensions (0-10). */
  total: number;
}

export interface TopicCritique {
  /** Phase A: deterministic structural scoring. */
  structural_score: StructuralScore;
  /** Phase B: LLM-based frame scoring (null if Phase B not yet run). */
  frame_score: FrameScore | null;
  /** Combined score (0-20). Structural-only if frame_score is null. */
  composite_score: number;
  /** Overall rating based on composite score. */
  rating: 'strong' | 'fair' | 'weak';
  /** Identified issues across both phases. */
  issues: TopicIssue[];
  /** Frame-specific rewriting suggestions (from Phase B). */
  reframe_suggestions: ReframeSuggestion[];
  /** LLM-generated rewritten topic (mandatory from Phase B). */
  rewritten_topic: string;
  /** Timestamp of when critique was computed. */
  computed_at: string;
  /** Whether reframing was applied to topic.final. */
  reframe_applied?: boolean;
  /** LLM explanation of what was changed during reframing. */
  reframe_changes?: string;
  /** True when evidence coverage scored 0 — topic is outside well-documented territory. */
  exploratory?: boolean;
}

// ── Constants ─────────────────────────────────────────────

/** Embedding similarity threshold for node activation. */
const ACTIVATION_THRESHOLD = 0.35;

/** Per-POV node count thresholds for abstraction level scoring. */
const ABSTRACTION_SWEET_SPOT = { min: 8, max: 15 };
const ABSTRACTION_ACCEPTABLE = { min: 5, max: 30 };

// ── Phase A: Structural Scoring ──────────────────────────

export interface StructuralScoreInput {
  /** Embedding of the topic text. */
  topicEmbedding: number[];
  /** All POV nodes across all perspectives. */
  povNodes: readonly { id: string; pov: string; category: Category }[];
  /** Situation/cross-cutting nodes. */
  situationNodes: readonly { id: string }[];
  /** Node embeddings map: nodeId → { pov, vector }. */
  embeddings: Record<string, { pov: string; vector: number[] }>;
  /** Source evidence index (optional — absent means evidence coverage = 0). */
  evidenceIndex?: SourceEvidenceIndex;
  /** Override the activation similarity threshold (default 0.35). */
  similarityThreshold?: number;
}

/**
 * Phase A: Compute structural quality score from taxonomy embeddings.
 * Pure function — no LLM calls, no side effects.
 */
export function computeStructuralScore(input: StructuralScoreInput): StructuralScore {
  const threshold = input.similarityThreshold ?? ACTIVATION_THRESHOLD;

  // 1. Compute similarity for all nodes and filter activated
  const activated: StructuralScore['activated_nodes'] = [];

  for (const [nodeId, entry] of Object.entries(input.embeddings)) {
    if (!entry.vector || entry.vector.length === 0) continue;
    const sim = cosineSimilarity(input.topicEmbedding, entry.vector);
    if (sim >= threshold) {
      const povNode = input.povNodes.find(n => n.id === nodeId);
      activated.push({
        id: nodeId,
        similarity: sim,
        pov: povNode?.pov ?? entry.pov,
        category: povNode?.category,
      });
    }
  }

  // Sort by similarity descending
  activated.sort((a, b) => b.similarity - a.similarity);

  // 2. Per-POV distribution (excluding situation nodes)
  const povDist: Record<string, number> = {};
  for (const node of activated) {
    if (node.id.startsWith('sit-') || node.id.startsWith('cc-')) continue;
    const pov = node.pov ?? 'unknown';
    povDist[pov] = (povDist[pov] ?? 0) + 1;
  }

  // 3. Per-BDI distribution
  const bdiDist: Record<string, number> = { Beliefs: 0, Desires: 0, Intentions: 0 };
  for (const node of activated) {
    if (node.category && node.category in bdiDist) {
      bdiDist[node.category]++;
    }
  }

  // 4. Score each dimension
  const crux_density = scoreCruxDensity(povDist);
  const evidence_coverage = scoreEvidenceCoverage(activated, input.evidenceIndex);
  const bdi_heterogeneity = scoreBdiHeterogeneity(bdiDist);
  const abstraction_level = scoreAbstractionLevel(povDist);
  const situation_activation = scoreSituationActivation(activated);

  const total = crux_density + evidence_coverage + bdi_heterogeneity + abstraction_level + situation_activation;

  return {
    crux_density,
    evidence_coverage,
    bdi_heterogeneity,
    abstraction_level,
    situation_activation,
    total,
    activated_nodes: activated,
    pov_distribution: povDist,
    bdi_distribution: bdiDist,
  };
}

// ── Phase A scoring helpers ──────────────────────────────

function scoreCruxDensity(povDist: Record<string, number>): 0 | 1 | 2 {
  const povs = Object.keys(povDist).filter(k => k !== 'unknown' && k !== 'situations');
  const counts = povs.map(p => povDist[p]);
  if (counts.length === 0) return 0;

  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  // Check if one POV dominates (>60% of activated nodes)
  const maxFraction = Math.max(...counts) / total;
  if (maxFraction > 0.60) return 0;

  // All three POVs balanced (20-40% each)?
  const allBalanced = counts.length >= 3 && counts.every(c => {
    const frac = c / total;
    return frac >= 0.20 && frac <= 0.40;
  });
  if (allBalanced) return 2;

  // Two POVs well-represented
  return 1;
}

function scoreEvidenceCoverage(
  activated: StructuralScore['activated_nodes'],
  evidenceIndex?: SourceEvidenceIndex,
): 0 | 1 | 2 {
  if (!evidenceIndex || activated.length === 0) return 0;

  let withEvidence = 0;
  let multiSource = 0;
  for (const node of activated) {
    const entry = evidenceIndex[node.id];
    if (entry && (entry.facts?.length > 0 || entry.keyPoints?.length > 0)) {
      withEvidence++;
      // Check multi-source: distinct doc_ids
      const docIds = new Set([
        ...(entry.facts ?? []).map(f => f.doc_id),
        ...(entry.keyPoints ?? []).map(k => k.doc_id),
      ]);
      if (docIds.size > 1) multiSource++;
    }
  }

  const ratio = withEvidence / activated.length;
  if (ratio > 0.60 && multiSource > 0) return 2;
  if (ratio >= 0.30) return 1;
  return 0;
}

function scoreBdiHeterogeneity(bdiDist: Record<string, number>): 0 | 1 | 2 {
  const total = Object.values(bdiDist).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  const fractions = Object.values(bdiDist).map(c => c / total);
  const above20 = fractions.filter(f => f >= 0.20).length;

  // All three layers active (>20% each)
  if (above20 >= 3) return 2;
  // Two layers represented (>20% each)
  if (above20 >= 2) return 1;
  // One BDI layer dominates (>70%)
  return 0;
}

function scoreAbstractionLevel(povDist: Record<string, number>): 0 | 1 | 2 {
  const povs = Object.keys(povDist).filter(k => k !== 'unknown' && k !== 'situations');
  if (povs.length === 0) return 0;

  const counts = povs.map(p => povDist[p]);
  const avgPerPov = counts.reduce((a, b) => a + b, 0) / counts.length;

  // Sweet spot: 8-15 per POV
  if (avgPerPov >= ABSTRACTION_SWEET_SPOT.min && avgPerPov <= ABSTRACTION_SWEET_SPOT.max) return 2;
  // Acceptable: 5-8 or 15-30
  if (avgPerPov >= ABSTRACTION_ACCEPTABLE.min && avgPerPov <= ABSTRACTION_ACCEPTABLE.max) return 1;
  // Too concrete (<5) or too abstract (>30)
  return 0;
}

function scoreSituationActivation(activated: StructuralScore['activated_nodes']): 0 | 1 | 2 {
  const sitCount = activated.filter(n => n.id.startsWith('sit-') || n.id.startsWith('cc-')).length;
  if (sitCount >= 2) return 2;
  if (sitCount === 1) return 1;
  return 0;
}

// ── Phase B: Frame Analysis Prompt ───────────────────────

/**
 * Build the LLM prompt for Phase B frame analysis.
 * Single call — returns structured JSON with frame scores + rewritten topic.
 */
export function critiqueTopicPrompt(topic: string, structuralContext?: string): string {
  const structuralBlock = structuralContext
    ? `

=== STRUCTURAL ANALYSIS (pre-computed from taxonomy) ===
${structuralContext}

Your REWRITTEN TOPIC must address any structural warnings above in addition to improving frame scores.
`
    : '';

  return `You are evaluating a debate topic for its potential to generate productive, wisdom-yielding discourse.
${structuralBlock}
Score the topic on these five FRAME dimensions. Each dimension scores 0, 1, or 2:

1. **Conditionality** (does the topic invite conditional reasoning?)
   - 0: Binary frame ("Should we X?" / "Is X good or bad?")
   - 1: Partial conditional ("Should we X given Y?")
   - 2: Fully conditional ("Under what conditions would X produce Y?")

2. **Mechanism focus** (does the topic ask about causal pathways?)
   - 0: Outcome-only ("Will X happen?")
   - 1: Mixed outcome + mechanism
   - 2: Mechanism-first ("Through what pathways does X lead to Y?")

3. **Stakeholder breadth** (does the topic distribute agency?)
   - 0: Single actor implied
   - 1: Two actors named
   - 2: Multiple stakeholders with distributed responsibility

4. **Tension acknowledgment** (does the topic name a genuine conflict?)
   - 0: Neutral/bland, no conflict surfaced
   - 1: Tension implied but not named
   - 2: Tension explicitly named + meta-invitation to question the frame

5. **Scope boundedness** (is the topic focused enough to produce falsifiable claims?)
   - 0: Open-ended, no constraints
   - 1: Partially bounded (some context given)
   - 2: Concrete artifacts, specific tension, bounded scope

TOPIC: "${topic}"

TASK: Score the topic, then rewrite it. Follow these steps IN ORDER:

Step 1 — Score each frame dimension for the ORIGINAL topic above.
Step 2 — For each dimension scoring below 2, write one reframe_suggestion explaining the weakness and a concrete replacement fragment.
Step 3 — Write rewritten_topic by starting from the original topic and INCORPORATING every reframe_suggestion from Step 2. Dimensions already at 2 must be PRESERVED — do not weaken them. The rewritten topic must be 1-3 sentences (similar length to the original). Do not bloat.
Step 4 — Self-check: mentally re-score your rewritten_topic. If ANY dimension dropped below its original score, revise before outputting.

Respond with ONLY this JSON (no markdown fences, no explanation):
{
  "frame_scores": {
    "conditionality": <0|1|2>,
    "mechanism": <0|1|2>,
    "stakeholder": <0|1|2>,
    "tension": <0|1|2>,
    "scope": <0|1|2>
  },
  "issues": [
    {
      "dimension": "<dimension name>",
      "severity": "<low|medium|high>",
      "description": "<what's wrong>",
      "suggestion": "<how to fix>"
    }
  ],
  "reframe_suggestions": [
    {
      "dimension": "<conditionality|mechanism|stakeholder|tension|scope>",
      "original_weakness": "<what's weak>",
      "reframed_fragment": "<suggested replacement fragment>"
    }
  ],
  "rewritten_topic": "<1-3 sentence rewrite incorporating ALL reframe_suggestions, preserving dimensions already at 2>"
}`;
}

/**
 * Parse the raw LLM response from Phase B into a full TopicCritique.
 * Combines Phase A structural score with Phase B frame analysis.
 */
export function parseTopicCritique(
  raw: string,
  structuralScore: StructuralScore,
): TopicCritique {
  // Clean LLM response
  let cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
  if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  const parsed = JSON.parse(cleaned) as {
    frame_scores?: {
      conditionality?: number;
      mechanism?: number;
      stakeholder?: number;
      tension?: number;
      scope?: number;
    };
    issues?: TopicIssue[];
    reframe_suggestions?: ReframeSuggestion[];
    rewritten_topic?: string;
  };

  const fs = parsed.frame_scores ?? {};
  const frameScore: FrameScore = {
    conditionality: clampScore(fs.conditionality),
    mechanism: clampScore(fs.mechanism),
    stakeholder: clampScore(fs.stakeholder),
    tension: clampScore(fs.tension),
    scope: clampScore(fs.scope),
    total: 0,
  };
  frameScore.total = frameScore.conditionality + frameScore.mechanism +
    frameScore.stakeholder + frameScore.tension + frameScore.scope;

  // Build structural issues from Phase A
  const structuralIssues = buildStructuralIssues(structuralScore);

  // Merge issues from both phases
  const issues = [
    ...structuralIssues,
    ...(parsed.issues ?? []),
  ];

  const compositeScore = structuralScore.total + frameScore.total;
  const rating: TopicCritique['rating'] =
    compositeScore >= 14 ? 'strong' :
    compositeScore >= 8 ? 'fair' :
    'weak';

  return {
    structural_score: structuralScore,
    frame_score: frameScore,
    composite_score: compositeScore,
    rating,
    issues,
    reframe_suggestions: parsed.reframe_suggestions ?? [],
    rewritten_topic: parsed.rewritten_topic ?? '',
    computed_at: new Date().toISOString(),
    exploratory: structuralScore.evidence_coverage === 0,
  };
}

// ── Helpers ──────────────────────────────────────────────

function clampScore(v: number | undefined): 0 | 1 | 2 {
  if (v === undefined || v === null) return 0;
  if (v <= 0) return 0;
  if (v >= 2) return 2;
  return Math.round(v) as 0 | 1 | 2;
}

function buildStructuralIssues(score: StructuralScore): TopicIssue[] {
  const issues: TopicIssue[] = [];

  if (score.crux_density === 0) {
    const povs = Object.entries(score.pov_distribution);
    if (povs.length === 0) {
      issues.push({
        dimension: 'crux_density',
        severity: 'high',
        description: 'Topic does not activate any taxonomy nodes. It may be too abstract or outside the taxonomy\'s coverage.',
        suggestion: 'Reframe with specific policy mechanisms or empirical claims that map to existing taxonomy nodes.',
      });
    } else {
      const dominant = povs.sort((a, b) => b[1] - a[1])[0];
      issues.push({
        dimension: 'crux_density',
        severity: 'high',
        description: `One POV dominates: ${dominant[0]} has ${dominant[1]} activated nodes. The debate will be lopsided.`,
        suggestion: 'Broaden the topic to engage underrepresented perspectives.',
      });
    }
  }

  if (score.evidence_coverage === 0) {
    issues.push({
      dimension: 'evidence_coverage',
      severity: 'medium',
      description: 'Activated nodes lack evidence entries. Debaters may hallucinate citations.',
      suggestion: 'Narrow the topic toward nodes with richer evidence, or run evidence enrichment first.',
    });
  }

  if (score.bdi_heterogeneity === 0) {
    const dominant = Object.entries(score.bdi_distribution).sort((a, b) => b[1] - a[1])[0];
    if (dominant) {
      issues.push({
        dimension: 'bdi_heterogeneity',
        severity: 'medium',
        description: `BDI imbalance: ${dominant[0]} dominates (${dominant[1]} nodes). The debate will be narrow.`,
        suggestion: dominant[0] === 'Beliefs'
          ? 'Add "how should..." to engage Intentions, or "what should we prioritize..." for Desires.'
          : dominant[0] === 'Desires'
          ? 'Add "is it true that..." to engage Beliefs, or "how should we implement..." for Intentions.'
          : 'Add "is it true that..." to engage Beliefs, or "what should we prioritize..." for Desires.',
      });
    }
  }

  if (score.abstraction_level === 0) {
    const counts = Object.values(score.pov_distribution);
    const avg = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
    issues.push({
      dimension: 'abstraction_level',
      severity: avg < 5 ? 'medium' : 'high',
      description: avg < 5
        ? `Too concrete: ${avg.toFixed(0)} nodes per POV. The debate will exhaust arguments quickly.`
        : `Too abstract: ${avg.toFixed(0)} nodes per POV. The debate will be unfocused.`,
      suggestion: avg < 5
        ? 'Broaden the topic to engage more taxonomy nodes across perspectives.'
        : 'Add specific constraints: name a policy mechanism, empirical phenomenon, or bounded scope.',
    });
  }

  if (score.situation_activation === 0) {
    issues.push({
      dimension: 'situation_activation',
      severity: 'low',
      description: 'No situation/cross-cutting nodes activated. Debaters may talk past each other.',
      suggestion: 'Frame the topic around a shared empirical phenomenon or contested concept.',
    });
  }

  return issues;
}

// ── Critique formatting for prompt injection ──────────────

/**
 * Format a TopicCritique as a text block for injection into the
 * concludingPrompt's critiqueContext parameter.
 *
 * Designed for the topic refinement stage — surfaces actionable issues
 * and reframe suggestions in natural language.
 */
export function formatCritiqueForRefinement(critique: TopicCritique): string {
  const parts: string[] = [];

  parts.push(`Current quality score: ${critique.composite_score}/20 (${critique.rating}).`);

  // Structural gaps
  const ss = critique.structural_score;
  const povEntries = Object.entries(ss.pov_distribution);
  if (povEntries.length > 0) {
    parts.push(`\nPerspective balance: ${povEntries.map(([p, n]) => `${p}: ${n} nodes`).join(', ')}.`);
  }
  const bdiEntries = Object.entries(ss.bdi_distribution).filter(([, n]) => n > 0);
  if (bdiEntries.length > 0) {
    parts.push(`BDI coverage: ${bdiEntries.map(([b, n]) => `${b}: ${n}`).join(', ')}.`);
  }

  // Issues (high and medium only — skip low severity to control prompt length)
  const actionableIssues = critique.issues.filter(i => i.severity !== 'low');
  if (actionableIssues.length > 0) {
    parts.push(`\nIssues to address in your refinement:`);
    for (const issue of actionableIssues) {
      parts.push(`- [${issue.severity}] ${issue.description} → ${issue.suggestion}`);
    }
  }

  // Reframe suggestions
  if (critique.reframe_suggestions.length > 0) {
    parts.push(`\nFrame improvements to incorporate:`);
    for (const rs of critique.reframe_suggestions) {
      parts.push(`- ${rs.dimension}: ${rs.original_weakness} → ${rs.reframed_fragment}`);
    }
  }

  // Frame scores (if available)
  if (critique.frame_score) {
    const fs = critique.frame_score;
    const weak = (['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const)
      .filter(d => fs[d] < 2)
      .map(d => `${d}: ${fs[d]}/2`);
    if (weak.length > 0) {
      parts.push(`\nFrame dimensions below maximum: ${weak.join(', ')}.`);
    }
  }

  return parts.join('\n');
}

/**
 * Format a StructuralScore as a text block for injection into
 * critiqueTopicPrompt's structuralContext parameter.
 *
 * Surfaces POV balance, BDI coverage, situation activation, and
 * sub-scores with actionable warnings for the LLM.
 */
export function formatStructuralContext(score: StructuralScore): string {
  const parts: string[] = [];

  // POV balance
  const povEntries = Object.entries(score.pov_distribution);
  if (povEntries.length > 0) {
    parts.push(`Perspective activation: ${povEntries.map(([p, n]) => `${p}: ${n} nodes`).join(', ')}.`);
    const total = povEntries.reduce((sum, [, n]) => sum + n, 0);
    const maxFrac = Math.max(...povEntries.map(([, n]) => n / total));
    if (maxFrac > 0.60) {
      const dominant = povEntries.sort((a, b) => b[1] - a[1])[0];
      parts.push(`WARNING: ${dominant[0]} dominates with ${(maxFrac * 100).toFixed(0)}% of activated nodes. The rewritten topic must give underrepresented perspectives a clear entry point.`);
    }
  } else {
    parts.push(`WARNING: No taxonomy nodes activated. The topic may be too abstract or outside the taxonomy coverage.`);
  }

  // BDI distribution
  const bdiEntries = Object.entries(score.bdi_distribution).filter(([, n]) => n > 0);
  if (bdiEntries.length > 0) {
    parts.push(`BDI layer coverage: ${bdiEntries.map(([b, n]) => `${b}: ${n}`).join(', ')}.`);
    const missing = ['Beliefs', 'Desires', 'Intentions'].filter(
      b => !score.bdi_distribution[b] || score.bdi_distribution[b] === 0
    );
    if (missing.length > 0) {
      parts.push(`Missing BDI layers: ${missing.join(', ')}. The rewritten topic should engage these layers.`);
    }
  }

  // Situation activation
  const sitCount = score.activated_nodes.filter(
    n => n.id.startsWith('sit-') || n.id.startsWith('cc-')
  ).length;
  if (sitCount === 0) {
    parts.push(`No situation nodes activated. The rewritten topic should anchor to a specific contested phenomenon or shared empirical observation.`);
  } else {
    parts.push(`Situation nodes activated: ${sitCount}.`);
  }

  // Structural sub-scores
  parts.push(`\nStructural sub-scores: crux_density=${score.crux_density}/2, evidence=${score.evidence_coverage}/2, bdi=${score.bdi_heterogeneity}/2, abstraction=${score.abstraction_level}/2, situations=${score.situation_activation}/2 (total: ${score.total}/10).`);

  return parts.join('\n');
}
