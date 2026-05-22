#!/usr/bin/env tsx
/**
 * Topic Refinement Experiment
 *
 * Baseline: 5 topics × 3 refinement iterations using the current concludingPrompt.
 * Treatment: Same 5 topics × 3 iterations with prior-attempt feedback injected.
 *
 * Measures frame scores (5 dimensions × 0-2 each = 10 max) per iteration.
 * Identifies dimensions that stagnate across iterations.
 *
 * Usage: cd taxonomy-editor && npx tsx scripts/topic-refinement-experiment.ts
 */

import path from 'path';
import fs from 'fs';
import { createCLIAdapter } from '../../lib/debate/aiAdapter.js';
import {
  critiqueTopicPrompt,
  parseTopicCritique,
  formatStructuralContext,
  formatCritiqueForRefinement,
} from '../../lib/debate/topicCritique.js';
import type { StructuralScore, FrameScore, TopicCritique } from '../../lib/debate/topicCritique.js';
import { concludingPrompt } from '../../lib/debate/prompts.js';

// ── Config ──────────────────────────────────────────────

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const REPO_ROOT = path.resolve(__dirname, '../..');
const MODEL = 'gemini-2.5-flash';
const ITERATIONS = 3;
const OUTPUT_FILE = path.resolve(__dirname, 'topic-refinement-results.json');

// 5 topics chosen for diversity: assertion, question, issue, different themes
const EXPERIMENT_TOPICS = [
  "The physical limits of power grids, cooling capacity, and silicon yields will halt AI scaling long before algorithmic breakthroughs yield AGI.",
  "Is AI safety regulation a necessary guardrail against existential catastrophe, or a legally codified monopoly designed to crush open-source competition?",
  "Deploying autonomous AI agents into real-world infrastructure is an uncontrollable systemic risk masquerading as a post-scarcity economic engine.",
  "Will delegating cognitive labor to machines elevate humanity to a higher evolutionary tier, or permanently atrophy our agency, intellect, and economic utility?",
  "AGI is not required to break the labor market; narrow, cheap, specialized models are already sufficient to cause structural unemployment that governments are entirely unprepared for.",
];

// ── Stub structural score (constant — we can't compute embeddings from CLI) ──

const STUB_STRUCTURAL: StructuralScore = {
  crux_density: 1,
  evidence_coverage: 0,
  bdi_heterogeneity: 1,
  abstraction_level: 1,
  situation_activation: 0,
  total: 3,
  activated_nodes: [],
  pov_distribution: { accelerationist: 5, safetyist: 4, skeptic: 3 },
  bdi_distribution: { Beliefs: 4, Desires: 3, Intentions: 2 },
};

// ── Types ───────────────────────────────────────────────

interface IterationResult {
  iteration: number;
  topic_text: string;
  frame_score: FrameScore;
  composite_score: number;
  rating: string;
  rewritten_topic: string;
  issues_count: number;
}

interface TopicExperiment {
  original_topic: string;
  iterations: IterationResult[];
}

interface ExperimentRun {
  label: string;
  model: string;
  timestamp: string;
  topics: TopicExperiment[];
  summary: RunSummary;
}

interface RunSummary {
  avg_initial_score: number;
  avg_final_score: number;
  avg_delta: number;
  dimension_deltas: Record<string, number>;
  stagnant_dimensions: string[];
}

// ── Helpers ─────────────────────────────────────────────

const adapter = createCLIAdapter(REPO_ROOT);

async function critiqueTopic(topic: string): Promise<TopicCritique> {
  const prompt = critiqueTopicPrompt(topic, formatStructuralContext(STUB_STRUCTURAL));
  const text = await adapter.generateText(prompt, MODEL, { temperature: 0.3 });
  return parseTopicCritique(text, STUB_STRUCTURAL);
}

/** Baseline refinement: same prompt every time (current behavior). */
function buildBaselineRefinementPrompt(originalTopic: string, critique: TopicCritique): string {
  // Simulate clarification synthesis — use the critique's reframe suggestions as "answers"
  const qaPairs = `\nAnalyst observed:\n  - Frame score: ${critique.frame_score?.total ?? 0}/10\n  - Issues: ${critique.issues.map(i => i.description).join('; ')}\nUser answered: Please improve the topic to address these issues.\n`;

  const critiqueContext = formatCritiqueForRefinement(critique);
  return concludingPrompt(originalTopic, qaPairs, undefined, critiqueContext);
}

/** Treatment refinement: injects feedback from the prior failed attempt. */
function buildFeedbackRefinementPrompt(
  originalTopic: string,
  critique: TopicCritique,
  priorAttempt: { topic: string; score: FrameScore; composite: number } | null,
): string {
  const qaPairs = `\nAnalyst observed:\n  - Frame score: ${critique.frame_score?.total ?? 0}/10\n  - Issues: ${critique.issues.map(i => i.description).join('; ')}\nUser answered: Please improve the topic to address these issues.\n`;

  let critiqueContext = formatCritiqueForRefinement(critique);

  if (priorAttempt) {
    const fs = priorAttempt.score;
    const weak = (['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const)
      .filter(d => fs[d] < 2)
      .map(d => `${d}: ${fs[d]}/2`);

    critiqueContext += `\n\n=== PRIOR ATTEMPT FEEDBACK ===
Your previous refinement attempt scored ${priorAttempt.composite}/20 (frame: ${fs.total}/10).
Previous attempt: "${priorAttempt.topic}"
Dimensions still below maximum: ${weak.join(', ')}.
DO NOT repeat the same phrasing. Try a substantially different approach to improve: ${weak.map(w => w.split(':')[0]).join(', ')}.
Specifically:${fs.conditionality < 2 ? '\n- Use "Under what conditions..." or "When does X lead to Y?" framing' : ''}${fs.mechanism < 2 ? '\n- Name specific causal pathways, not just outcomes' : ''}${fs.stakeholder < 2 ? '\n- Name 3+ distinct actors with different responsibilities' : ''}${fs.tension < 2 ? '\n- Explicitly name the core tension AND invite questioning of the frame itself' : ''}${fs.scope < 2 ? '\n- Anchor to specific artifacts: a policy, a metric, a threshold, a timeline' : ''}`;
  }

  return concludingPrompt(originalTopic, qaPairs, undefined, critiqueContext);
}

function parseRefinedTopic(raw: string): string {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) {
      const parsed = JSON.parse(cleaned.slice(fb, lb + 1));
      if (parsed.refined_topic) return parsed.refined_topic;
    }
  } catch { /* fall through */ }
  return raw.trim();
}

async function runIteration(
  originalTopic: string,
  currentTopic: string,
  iteration: number,
  mode: 'baseline' | 'feedback',
  priorAttempt: { topic: string; score: FrameScore; composite: number } | null,
): Promise<IterationResult> {
  // Step 1: Critique the current topic
  const critique = await critiqueTopic(currentTopic);

  // Step 2: Refine
  const prompt = mode === 'baseline'
    ? buildBaselineRefinementPrompt(originalTopic, critique)
    : buildFeedbackRefinementPrompt(originalTopic, critique, priorAttempt);

  const raw = await adapter.generateText(prompt, MODEL, { temperature: 0.5 });
  const refined = parseRefinedTopic(raw);

  // Step 3: Score the refined topic
  const refinedCritique = await critiqueTopic(refined);

  return {
    iteration,
    topic_text: refined,
    frame_score: refinedCritique.frame_score!,
    composite_score: refinedCritique.composite_score,
    rating: refinedCritique.rating,
    rewritten_topic: refinedCritique.rewritten_topic,
    issues_count: refinedCritique.issues.length,
  };
}

function computeSummary(topics: TopicExperiment[]): RunSummary {
  const dims = ['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const;

  let sumInitial = 0, sumFinal = 0;
  const dimInitial: Record<string, number> = {};
  const dimFinal: Record<string, number> = {};
  for (const d of dims) { dimInitial[d] = 0; dimFinal[d] = 0; }

  for (const t of topics) {
    if (t.iterations.length === 0) continue;
    const first = t.iterations[0];
    const last = t.iterations[t.iterations.length - 1];
    sumInitial += first.composite_score;
    sumFinal += last.composite_score;
    for (const d of dims) {
      dimInitial[d] += first.frame_score[d];
      dimFinal[d] += last.frame_score[d];
    }
  }

  const n = topics.length || 1;
  const dimensionDeltas: Record<string, number> = {};
  const stagnant: string[] = [];
  for (const d of dims) {
    const delta = (dimFinal[d] - dimInitial[d]) / n;
    dimensionDeltas[d] = Math.round(delta * 100) / 100;
    if (Math.abs(delta) < 0.2) stagnant.push(d);
  }

  return {
    avg_initial_score: Math.round((sumInitial / n) * 100) / 100,
    avg_final_score: Math.round((sumFinal / n) * 100) / 100,
    avg_delta: Math.round(((sumFinal - sumInitial) / n) * 100) / 100,
    dimension_deltas: dimensionDeltas,
    stagnant_dimensions: stagnant,
  };
}

// ── Main ────────────────────────────────────────────────

async function runExperiment(
  label: string,
  mode: 'baseline' | 'feedback',
): Promise<ExperimentRun> {
  const topics: TopicExperiment[] = [];

  for (let t = 0; t < EXPERIMENT_TOPICS.length; t++) {
    const original = EXPERIMENT_TOPICS[t];
    console.log(`\n[${'='.repeat(60)}]`);
    console.log(`[${label}] Topic ${t + 1}/${EXPERIMENT_TOPICS.length}: ${original.slice(0, 80)}...`);

    const iterations: IterationResult[] = [];
    let currentTopic = original;
    let priorAttempt: { topic: string; score: FrameScore; composite: number } | null = null;

    for (let i = 0; i < ITERATIONS; i++) {
      console.log(`  Iteration ${i + 1}/${ITERATIONS}...`);
      try {
        const result = await runIteration(original, currentTopic, i + 1, mode, priorAttempt);
        iterations.push(result);
        console.log(`    Score: ${result.composite_score}/20 (frame: ${result.frame_score.total}/10)`);
        console.log(`    C=${result.frame_score.conditionality} M=${result.frame_score.mechanism} S=${result.frame_score.stakeholder} T=${result.frame_score.tension} Sc=${result.frame_score.scope}`);

        // Feed forward for next iteration
        priorAttempt = {
          topic: result.topic_text,
          score: result.frame_score,
          composite: result.composite_score,
        };
        currentTopic = result.topic_text;
      } catch (err) {
        console.error(`    ERROR: ${err instanceof Error ? err.message : err}`);
        break;
      }
    }

    topics.push({ original_topic: original, iterations });
  }

  return {
    label,
    model: MODEL,
    timestamp: new Date().toISOString(),
    topics,
    summary: computeSummary(topics),
  };
}

async function main() {
  console.log('Topic Refinement Experiment');
  console.log(`Model: ${MODEL}, Iterations: ${ITERATIONS}, Topics: ${EXPERIMENT_TOPICS.length}`);
  console.log('');

  // Phase 1: Baseline
  console.log('=== PHASE 1: BASELINE (identical prompt on each retry) ===');
  const baseline = await runExperiment('baseline', 'baseline');

  console.log('\n--- Baseline Summary ---');
  console.log(`  Avg initial: ${baseline.summary.avg_initial_score}/20`);
  console.log(`  Avg final:   ${baseline.summary.avg_final_score}/20`);
  console.log(`  Avg delta:   ${baseline.summary.avg_delta > 0 ? '+' : ''}${baseline.summary.avg_delta}`);
  console.log(`  Dimension deltas: ${JSON.stringify(baseline.summary.dimension_deltas)}`);
  console.log(`  Stagnant dims:    ${baseline.summary.stagnant_dimensions.join(', ') || '(none)'}`);

  // Phase 2: Treatment (inject feedback)
  console.log('\n=== PHASE 2: TREATMENT (prior-attempt feedback injected) ===');
  const treatment = await runExperiment('feedback', 'feedback');

  console.log('\n--- Treatment Summary ---');
  console.log(`  Avg initial: ${treatment.summary.avg_initial_score}/20`);
  console.log(`  Avg final:   ${treatment.summary.avg_final_score}/20`);
  console.log(`  Avg delta:   ${treatment.summary.avg_delta > 0 ? '+' : ''}${treatment.summary.avg_delta}`);
  console.log(`  Dimension deltas: ${JSON.stringify(treatment.summary.dimension_deltas)}`);
  console.log(`  Stagnant dims:    ${treatment.summary.stagnant_dimensions.join(', ') || '(none)'}`);

  // Comparison
  console.log('\n=== COMPARISON ===');
  const dims = ['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const;
  console.log('Dimension         | Baseline delta | Treatment delta | Improvement');
  console.log('------------------|----------------|-----------------|------------');
  for (const d of dims) {
    const bd = baseline.summary.dimension_deltas[d] ?? 0;
    const td = treatment.summary.dimension_deltas[d] ?? 0;
    const imp = td - bd;
    console.log(`${d.padEnd(18)}| ${bd.toFixed(2).padStart(14)} | ${td.toFixed(2).padStart(15)} | ${imp > 0 ? '+' : ''}${imp.toFixed(2)}`);
  }

  const overallImp = treatment.summary.avg_delta - baseline.summary.avg_delta;
  console.log(`\nOverall: baseline delta ${baseline.summary.avg_delta.toFixed(2)}, treatment delta ${treatment.summary.avg_delta.toFixed(2)}, improvement: ${overallImp > 0 ? '+' : ''}${overallImp.toFixed(2)}`);

  // Regression check
  const regressions: string[] = [];
  for (const d of dims) {
    const bd = baseline.summary.dimension_deltas[d] ?? 0;
    const td = treatment.summary.dimension_deltas[d] ?? 0;
    if (td < bd - 0.1) regressions.push(`${d}: treatment ${td.toFixed(2)} < baseline ${bd.toFixed(2)}`);
  }
  if (regressions.length > 0) {
    console.log(`\nREGRESSIONS DETECTED:`);
    for (const r of regressions) console.log(`  - ${r}`);
  } else {
    console.log(`\nNo regressions detected.`);
  }

  // Save results
  const results = { baseline, treatment, comparison: { overall_improvement: overallImp, regressions } };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
