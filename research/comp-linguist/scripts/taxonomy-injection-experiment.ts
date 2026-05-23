#!/usr/bin/env tsx
/**
 * Taxonomy Injection Dose-Response Experiment
 *
 * Measures how the number of injected taxonomy nodes (maxTotal) and the
 * BDI floor (minPerBdi) affect debate quality, utilization rates, and
 * BDI distribution.
 *
 * Design:
 *   - Independent variables:
 *     - maxTotal ∈ {10, 15, 20, 25, 30, 35}  (total POV nodes injected)
 *     - minPerBdi ∈ {3, 5, 7}                 (floor per BDI category)
 *   - Controlled: same topic, same model, same pacing, adaptive staging on
 *   - Dependent variables: utilization rate, primary utilization, crux addressed
 *     ratio, taxonomy mapped ratio, BDI distribution, relevance score variance
 *   - Replicates: N per condition (default 1, configurable)
 *
 * Prerequisites:
 *   1. Engine env var overrides applied (Shared Lib):
 *      - TAXONOMY_MAX_NODES  (defaults to 35)
 *      - TAXONOMY_MIN_PER_BDI (defaults to 3)
 *   2. Set GEMINI_API_KEY (or AI_API_KEY) in your environment
 *
 * Usage:
 *   cd research/comp-linguist
 *   npx tsx scripts/taxonomy-injection-experiment.ts
 *   npx tsx scripts/taxonomy-injection-experiment.ts --levels 10,20,35 --reps 2
 *   npx tsx scripts/taxonomy-injection-experiment.ts --floors 3,5,7 --levels 20,25
 *   npx tsx scripts/taxonomy-injection-experiment.ts --topic "Should AI development be paused?"
 *   npx tsx scripts/taxonomy-injection-experiment.ts --analyze-only results/injection-experiment-*.json
 *
 * Output:
 *   results/injection-experiment-{timestamp}.json  — raw data
 *   results/injection-experiment-{timestamp}.md    — comparison report
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

// ── Config ──────────────────────────────────────────────

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const RESULTS_DIR = path.resolve(__dirname, '../results');
const CLI_PATH = path.join(REPO_ROOT, 'lib/debate/cli.ts');

const DEFAULT_LEVELS = [10, 15, 20, 25, 30, 35];
const DEFAULT_REPS = 2;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_PACING = 'tight' as const;   // minimize cost per run

const DEFAULT_TOPIC =
  'Will narrow AI automation cause structural unemployment that governments ' +
  'are unprepared for, or will new industries absorb displaced workers as they ' +
  'have in previous technological transitions?';

// ── CLI arg parsing ─────────────────────────────────────

interface ExperimentConfig {
  levels: number[];
  floors: number[];
  reps: number;
  topic: string;
  model: string;
  pacing: 'tight' | 'moderate' | 'thorough';
  analyzeOnly?: string[];
}

function parseArgs(): ExperimentConfig {
  const args = process.argv.slice(2);
  const config: ExperimentConfig = {
    levels: DEFAULT_LEVELS,
    floors: [3],
    reps: DEFAULT_REPS,
    topic: DEFAULT_TOPIC,
    model: DEFAULT_MODEL,
    pacing: DEFAULT_PACING,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--levels':
        config.levels = args[++i].split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b);
        break;
      case '--floors':
        config.floors = args[++i].split(',').map(Number).filter(n => n > 0).sort((a, b) => a - b);
        break;
      case '--reps':
        config.reps = Math.max(1, parseInt(args[++i]) || DEFAULT_REPS);
        break;
      case '--topic':
        config.topic = args[++i];
        break;
      case '--model':
        config.model = args[++i];
        break;
      case '--pacing':
        config.pacing = args[++i] as ExperimentConfig['pacing'];
        break;
      case '--analyze-only':
        config.analyzeOnly = args.slice(i + 1);
        i = args.length; // consume remaining args as file paths
        break;
      case '--help':
        printUsage();
        process.exit(0);
    }
  }

  // Validate: floor × 3 must not exceed maxTotal
  for (const floor of config.floors) {
    for (const level of config.levels) {
      if (floor * 3 > level) {
        console.warn(`  Warning: floor=${floor} × 3 BDI categories = ${floor * 3} > maxTotal=${level}. This combination will be skipped.`);
      }
    }
  }

  return config;
}

function printUsage(): void {
  console.log(`
Taxonomy Injection Dose-Response Experiment

Usage:
  npx tsx scripts/taxonomy-injection-experiment.ts [options]

Options:
  --levels 10,20,35    Comma-separated maxTotal values to test (default: 10,15,20,25,30,35)
  --floors 3,5,7       Comma-separated minPerBdi values to test (default: 3)
  --reps N             Replicates per condition (default: 2)
  --topic "..."        Debate topic (default: built-in employment topic)
  --model MODEL        AI model (default: gemini-2.5-flash)
  --pacing tight|moderate|thorough  Debate pacing (default: tight)
  --analyze-only FILE [FILE...]     Skip running, analyze existing result files
  --help               Show this help

Grid mode: when --floors has multiple values, each (level, floor) combination is tested.
  Example: --levels 20,25 --floors 3,5,7 runs 6 conditions × reps each.
`);
}

// ── Types ───────────────────────────────────────────────

interface RunResult {
  level: number;
  floor: number;
  rep: number;
  debate_id: string;
  rounds: number;
  duration_ms: number;

  // Primary metrics
  avg_utilization_rate: number | null;
  avg_primary_utilization: number | null;
  crux_addressed_ratio: number | null;
  engaging_real_disagreement: boolean | null;
  taxonomy_mapped_ratio: number | null;
  relevance_score_variance: number | null;

  // BDI distribution (from injection manifests)
  bdi_distribution: { beliefs: number; desires: number; intentions: number };
  total_injected: number;

  // Cost
  total_api_calls: number;

  // Anti-exploit metrics
  low_value_claims_rejected: number;
  topic_coherence_per_speaker: Record<string, number> | null;

  // Agent utilities (game theory layer)
  agent_utilities: Record<string, { composite: number }> | null;

  // Error flag
  error?: string;
}

interface ExperimentData {
  experiment_id: string;
  timestamp: string;
  config: {
    levels: number[];
    floors: number[];
    reps: number;
    topic: string;
    model: string;
    pacing: string;
  };
  runs: RunResult[];
}

// ── Preflight checks ────────────────────────────────────

function preflight(config: ExperimentConfig): void {
  // Check env var patch is applied
  const enginePath = path.join(REPO_ROOT, 'lib/debate/debateEngine.ts');
  const engineSrc = fs.readFileSync(enginePath, 'utf-8');
  const missing: string[] = [];
  if (!engineSrc.includes('TAXONOMY_MAX_NODES')) missing.push('TAXONOMY_MAX_NODES');
  if (!engineSrc.includes('TAXONOMY_MIN_PER_BDI')) missing.push('TAXONOMY_MIN_PER_BDI');
  if (missing.length > 0) {
    console.error(`
╔══════════════════════════════════════════════════════════════╗
║  ENGINE PATCH NOT APPLIED                                    ║
║                                                              ║
║  Missing env var overrides in debateEngine.ts:               ║
║    ${missing.join(', ').padEnd(51)}║
║                                                              ║
║  Required patches (line ~1183-1184):                         ║
║    maxTotal: parseInt(process.env.TAXONOMY_MAX_NODES || '') || 35,    ║
║    minPerCategory: parseInt(process.env.TAXONOMY_MIN_PER_BDI || '') || 3, ║
║                                                              ║
║  Route to Shared Lib for approval before applying.           ║
╚══════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  // Check API key
  if (!process.env.GEMINI_API_KEY && !process.env.AI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error('No API key found. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY.');
    process.exit(1);
  }

  // Ensure results dir
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const conditions = config.levels.length * config.floors.length;
  const totalRuns = conditions * config.reps;
  console.log(`\n  Experiment: Taxonomy Injection Dose-Response`);
  console.log(`  Levels (maxTotal): ${config.levels.join(', ')}`);
  console.log(`  Floors (minPerBdi): ${config.floors.join(', ')}`);
  console.log(`  Conditions: ${conditions} | Reps: ${config.reps} | Total runs: ${totalRuns}`);
  console.log(`  Model: ${config.model}`);
  console.log(`  Pacing: ${config.pacing}`);
  console.log(`  Topic: "${config.topic.slice(0, 80)}..."`);
  console.log();
}

// ── Run a single debate ─────────────────────────────────

async function runDebate(
  level: number,
  floor: number,
  rep: number,
  config: ExperimentConfig,
): Promise<RunResult> {
  const runId = `L${level}-F${floor}-R${rep}`;
  const tmpDir = path.join(RESULTS_DIR, `tmp-${runId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Write CLI config
  const cliConfig = {
    topic: config.topic,
    name: `injection-experiment-${runId}`,
    model: config.model,
    useAdaptiveStaging: true,
    pacing: config.pacing,
    outputDir: tmpDir,
    outputFormat: 'json',
  };
  const configPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(cliConfig, null, 2));

  // Run debate with TAXONOMY_MAX_NODES override
  const startTime = Date.now();
  return new Promise<RunResult>((resolve) => {
    const env = { ...process.env, TAXONOMY_MAX_NODES: String(level), TAXONOMY_MIN_PER_BDI: String(floor) };
    const child = spawn('npx', ['tsx', CLI_PATH, '--config', configPath], {
      env,
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => {
      const line = d.toString();
      stderr += line;
      // Stream progress to console
      for (const l of line.split('\n').filter(Boolean)) {
        process.stderr.write(`  [${runId}] ${l}\n`);
      }
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;

      if (code !== 0) {
        resolve({
          level, floor, rep, debate_id: '', rounds: 0, duration_ms: durationMs,
          avg_utilization_rate: null, avg_primary_utilization: null,
          crux_addressed_ratio: null, engaging_real_disagreement: null,
          taxonomy_mapped_ratio: null, relevance_score_variance: null,
          bdi_distribution: { beliefs: 0, desires: 0, intentions: 0 },
          total_injected: 0, total_api_calls: 0,
          low_value_claims_rejected: 0,
          topic_coherence_per_speaker: null, agent_utilities: null,
          error: `CLI exited with code ${code}: ${stderr.slice(-500)}`,
        });
        return;
      }

      // Parse the session JSON from stdout (CLI prints it)
      try {
        const session = JSON.parse(stdout);
        const result = extractMetrics(session, level, floor, rep, durationMs);
        // Save the session for later re-analysis
        const sessionPath = path.join(tmpDir, 'session.json');
        fs.writeFileSync(sessionPath, stdout);
        resolve(result);
      } catch (err) {
        // Try reading from output directory
        try {
          const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.json') && f !== 'config.json');
          const sessionFile = files.find(f => f.includes('session') || f.includes('debate'));
          if (sessionFile) {
            const session = JSON.parse(fs.readFileSync(path.join(tmpDir, sessionFile), 'utf-8'));
            resolve(extractMetrics(session, level, floor, rep, durationMs));
          } else {
            resolve({
              level, floor, rep, debate_id: '', rounds: 0, duration_ms: durationMs,
              avg_utilization_rate: null, avg_primary_utilization: null,
              crux_addressed_ratio: null, engaging_real_disagreement: null,
              taxonomy_mapped_ratio: null, relevance_score_variance: null,
              bdi_distribution: { beliefs: 0, desires: 0, intentions: 0 },
              total_injected: 0, total_api_calls: 0,
              low_value_claims_rejected: 0,
              topic_coherence_per_speaker: null, agent_utilities: null,
              error: `Could not parse session output: ${String(err)}`,
            });
          }
        } catch (readErr) {
          resolve({
            level, floor, rep, debate_id: '', rounds: 0, duration_ms: durationMs,
            avg_utilization_rate: null, avg_primary_utilization: null,
            crux_addressed_ratio: null, engaging_real_disagreement: null,
            taxonomy_mapped_ratio: null, relevance_score_variance: null,
            bdi_distribution: { beliefs: 0, desires: 0, intentions: 0 },
            total_injected: 0, total_api_calls: 0,
            low_value_claims_rejected: 0,
            topic_coherence_per_speaker: null, agent_utilities: null,
            error: `Failed to read output: ${String(readErr)}`,
          });
        }
      }
    });
  });
}

// ── Extract metrics from a debate session ───────────────

function extractMetrics(
  session: any,
  level: number,
  floor: number,
  rep: number,
  durationMs: number,
): RunResult {
  // Extract from calibration data if embedded, otherwise compute from session
  const cal = session.calibration_data ?? {};
  const transcript = session.transcript ?? [];
  const an = session.argument_network ?? { nodes: [], edges: [] };

  // Compute utilization from injection manifests
  let totalUtil = 0, totalPrimaryUtil = 0, utilCount = 0;
  const bdiCounts = { beliefs: 0, desires: 0, intentions: 0 };
  let totalInjected = 0;

  for (const entry of transcript) {
    if (entry.type !== 'opening' && entry.type !== 'statement') continue;
    const manifest = entry.metadata?.injection_manifest;
    if (!manifest) continue;

    const referencedIds = new Set(
      (entry.taxonomy_refs ?? []).map((r: any) => r.node_id ?? r),
    );

    if (manifest.povNodeIds?.length > 0) {
      const injected = manifest.povNodeIds.length;
      const referenced = manifest.povNodeIds.filter((id: string) => referencedIds.has(id)).length;
      totalUtil += referenced / injected;

      if (manifest.povPrimaryIds?.length > 0) {
        const primaryRef = manifest.povPrimaryIds.filter((id: string) => referencedIds.has(id)).length;
        totalPrimaryUtil += primaryRef / manifest.povPrimaryIds.length;
      }
      utilCount++;
      totalInjected += injected;

      // Count BDI from node IDs (pattern: {pov}-{category}-{NNN})
      for (const id of manifest.povNodeIds) {
        if (/-beliefs?-/i.test(id)) bdiCounts.beliefs++;
        else if (/-desires?-/i.test(id)) bdiCounts.desires++;
        else if (/-intentions?-/i.test(id)) bdiCounts.intentions++;
      }
    }
  }

  // Taxonomy mapped ratio: AN nodes with taxonomy_refs / total AN nodes
  const anNodes = an.nodes ?? [];
  const mappedNodes = anNodes.filter((n: any) => n.taxonomy_refs?.length > 0);
  const taxonomyMappedRatio = anNodes.length > 0 ? mappedNodes.length / anNodes.length : null;

  // Relevance score variance from injection manifests
  const allScores: number[] = [];
  for (const entry of transcript) {
    const scores = entry.metadata?.injection_manifest?.nodeScores;
    if (Array.isArray(scores)) allScores.push(...scores);
  }
  const relevanceVariance = allScores.length > 1
    ? variance(allScores)
    : null;

  // Neutral evaluation metrics
  const finalEval = (session.neutral_evaluations ?? []).find((e: any) => e.checkpoint === 'final');

  // Crux addressed ratio
  let cruxRatio: number | null = null;
  if (finalEval?.cruxes?.length > 0) {
    cruxRatio = finalEval.cruxes.filter((c: any) => c.status === 'addressed').length / finalEval.cruxes.length;
  }

  return {
    level,
    floor,
    rep,
    debate_id: session.id ?? '',
    rounds: transcript.filter((e: any) => e.type === 'opening' || e.type === 'statement').length,
    duration_ms: durationMs,
    avg_utilization_rate: utilCount > 0 ? totalUtil / utilCount : null,
    avg_primary_utilization: utilCount > 0 ? totalPrimaryUtil / utilCount : null,
    crux_addressed_ratio: cruxRatio,
    engaging_real_disagreement: finalEval?.overall_assessment?.debate_is_engaging_real_disagreement ?? null,
    taxonomy_mapped_ratio: taxonomyMappedRatio,
    relevance_score_variance: relevanceVariance,
    bdi_distribution: utilCount > 0
      ? {
          beliefs: Math.round(bdiCounts.beliefs / utilCount),
          desires: Math.round(bdiCounts.desires / utilCount),
          intentions: Math.round(bdiCounts.intentions / utilCount),
        }
      : { beliefs: 0, desires: 0, intentions: 0 },
    total_injected: utilCount > 0 ? Math.round(totalInjected / utilCount) : 0,
    total_api_calls: session.diagnostics?.overview?.total_ai_calls ?? cal.total_api_calls ?? 0,
    low_value_claims_rejected: cal.low_value_claims_rejected ?? 0,
    topic_coherence_per_speaker: cal.topic_coherence_per_speaker ?? null,
    agent_utilities: cal.agent_utilities ?? null,
  };
}

// ── Statistical helpers ─────────────────────────────────

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1);
}

function stddev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

function fmt(n: number | null, decimals = 3): string {
  return n != null ? n.toFixed(decimals) : '—';
}

function pct(n: number | null): string {
  return n != null ? `${(n * 100).toFixed(1)}%` : '—';
}

// ── Analysis & reporting ────────────────────────────────

interface ConditionSummary {
  level: number;
  floor: number;
  n: number;
  utilization: { mean: number; sd: number };
  primary_utilization: { mean: number; sd: number };
  crux_addressed: { mean: number; sd: number };
  taxonomy_mapped: { mean: number; sd: number };
  relevance_variance: { mean: number; sd: number };
  bdi: { beliefs: number; desires: number; intentions: number };
  api_calls: { mean: number; sd: number };
  errors: number;
}

function summarizeByCondition(runs: RunResult[]): ConditionSummary[] {
  // Build unique (level, floor) conditions
  const conditionKeys = [...new Set(runs.map(r => `${r.level}:${r.floor}`))];
  const conditions = conditionKeys
    .map(k => { const [l, f] = k.split(':').map(Number); return { level: l, floor: f }; })
    .sort((a, b) => a.level - b.level || a.floor - b.floor);

  return conditions.map(({ level, floor }) => {
    const condRuns = runs.filter(r => r.level === level && r.floor === floor && !r.error);
    const errorRuns = runs.filter(r => r.level === level && r.floor === floor && r.error);
    const n = condRuns.length;

    const extract = (fn: (r: RunResult) => number | null): number[] =>
      condRuns.map(fn).filter((v): v is number => v != null);

    return {
      level,
      floor,
      n,
      utilization: {
        mean: mean(extract(r => r.avg_utilization_rate)),
        sd: stddev(extract(r => r.avg_utilization_rate)),
      },
      primary_utilization: {
        mean: mean(extract(r => r.avg_primary_utilization)),
        sd: stddev(extract(r => r.avg_primary_utilization)),
      },
      crux_addressed: {
        mean: mean(extract(r => r.crux_addressed_ratio)),
        sd: stddev(extract(r => r.crux_addressed_ratio)),
      },
      taxonomy_mapped: {
        mean: mean(extract(r => r.taxonomy_mapped_ratio)),
        sd: stddev(extract(r => r.taxonomy_mapped_ratio)),
      },
      relevance_variance: {
        mean: mean(extract(r => r.relevance_score_variance)),
        sd: stddev(extract(r => r.relevance_score_variance)),
      },
      bdi: {
        beliefs: mean(condRuns.map(r => r.bdi_distribution.beliefs)),
        desires: mean(condRuns.map(r => r.bdi_distribution.desires)),
        intentions: mean(condRuns.map(r => r.bdi_distribution.intentions)),
      },
      api_calls: {
        mean: mean(condRuns.map(r => r.total_api_calls)),
        sd: stddev(condRuns.map(r => r.total_api_calls)),
      },
      errors: errorRuns.length,
    };
  });
}

function generateReport(data: ExperimentData): string {
  const summaries = summarizeByCondition(data.runs);
  const lines: string[] = [];
  const hasMultipleFloors = (data.config.floors?.length ?? 1) > 1;

  lines.push('# Taxonomy Injection Dose-Response Experiment');
  lines.push('');
  lines.push(`**Date:** ${data.timestamp}`);
  lines.push(`**Topic:** ${data.config.topic}`);
  lines.push(`**Model:** ${data.config.model} | **Pacing:** ${data.config.pacing} | **Reps:** ${data.config.reps}`);
  if (hasMultipleFloors) {
    lines.push(`**Grid:** maxTotal × minPerBdi = ${data.config.levels?.join(',')} × ${data.config.floors?.join(',')}`);
  }
  lines.push('');

  // Main results table
  lines.push('## Results');
  lines.push('');
  const floorCol = hasMultipleFloors ? ' minBDI |' : '';
  const floorDash = hasMultipleFloors ? '--------|' : '';
  lines.push(`| maxTotal |${floorCol} n | Utilization | Primary Util | Crux Addressed | Tax Mapped | Relevance Var | API Calls | Errors |`);
  lines.push(`|----------|${floorDash}---|-------------|-------------|----------------|------------|---------------|-----------|--------|`);
  for (const s of summaries) {
    const floorVal = hasMultipleFloors ? ` ${s.floor} |` : '';
    lines.push(
      `| ${s.level} |${floorVal} ${s.n} ` +
      `| ${pct(s.utilization.mean)} ±${pct(s.utilization.sd)} ` +
      `| ${pct(s.primary_utilization.mean)} ±${pct(s.primary_utilization.sd)} ` +
      `| ${pct(s.crux_addressed.mean)} ±${pct(s.crux_addressed.sd)} ` +
      `| ${pct(s.taxonomy_mapped.mean)} ±${pct(s.taxonomy_mapped.sd)} ` +
      `| ${fmt(s.relevance_variance.mean, 4)} ` +
      `| ${s.api_calls.mean.toFixed(0)} ±${s.api_calls.sd.toFixed(0)} ` +
      `| ${s.errors} |`,
    );
  }
  lines.push('');

  // BDI distribution table
  lines.push('## BDI Distribution (avg nodes per turn)');
  lines.push('');
  lines.push(`| maxTotal |${floorCol} Beliefs | Desires | Intentions | B:D:I Ratio |`);
  lines.push(`|----------|${floorDash}---------|---------|------------|-------------|`);
  for (const s of summaries) {
    const floorVal = hasMultipleFloors ? ` ${s.floor} |` : '';
    const total = s.bdi.beliefs + s.bdi.desires + s.bdi.intentions;
    const ratio = total > 0
      ? `${(s.bdi.beliefs / total * 100).toFixed(0)}:${(s.bdi.desires / total * 100).toFixed(0)}:${(s.bdi.intentions / total * 100).toFixed(0)}`
      : '—';
    lines.push(
      `| ${s.level} |${floorVal} ${s.bdi.beliefs.toFixed(1)} | ${s.bdi.desires.toFixed(1)} | ${s.bdi.intentions.toFixed(1)} | ${ratio} |`,
    );
  }
  lines.push('');

  // Key finding: utilization curve
  lines.push('## Analysis');
  lines.push('');

  if (summaries.length >= 2) {
    const first = summaries[0];
    const last = summaries[summaries.length - 1];

    const utilDelta = (first.utilization.mean - last.utilization.mean);
    const cruxDelta = (last.crux_addressed.mean - first.crux_addressed.mean);

    lines.push('### Utilization Curve');
    if (utilDelta > 0.05) {
      lines.push(
        `Utilization **declines** from ${pct(first.utilization.mean)} (maxTotal=${first.level}) ` +
        `to ${pct(last.utilization.mean)} (maxTotal=${last.level}), ` +
        `a drop of ${pct(utilDelta)}. This suggests diminishing returns — ` +
        `the LLM ignores a growing fraction of injected nodes as the list grows.`,
      );
    } else if (utilDelta < -0.05) {
      lines.push(
        `Utilization **increases** from ${pct(first.utilization.mean)} to ${pct(last.utilization.mean)} ` +
        `— more context is better. The LLM can absorb additional nodes productively.`,
      );
    } else {
      lines.push(
        `Utilization is **flat** across levels (${pct(first.utilization.mean)} → ${pct(last.utilization.mean)}). ` +
        `The LLM references a consistent fraction regardless of injection count.`,
      );
    }
    lines.push('');

    lines.push('### Quality Impact');
    if (Math.abs(cruxDelta) > 0.05) {
      lines.push(
        `Crux addressed ratio ${cruxDelta > 0 ? 'improves' : 'degrades'} ` +
        `from ${pct(first.crux_addressed.mean)} to ${pct(last.crux_addressed.mean)} ` +
        `(Δ = ${cruxDelta > 0 ? '+' : ''}${pct(cruxDelta)}).`,
      );
    } else {
      lines.push(
        `Crux addressed ratio is **stable** across levels. ` +
        `Injection count does not significantly affect debate substance quality.`,
      );
    }
    lines.push('');

    // Find the "sweet spot"
    const bestLevel = summaries.reduce((best, s) => {
      // Score: high utilization × high crux ratio, penalize high variance
      const score =
        (s.utilization.mean || 0.5) *
        (s.crux_addressed.mean || 0.5) *
        (1 - Math.min(s.relevance_variance.mean || 0, 0.1) * 5);
      const bestScore =
        (best.utilization.mean || 0.5) *
        (best.crux_addressed.mean || 0.5) *
        (1 - Math.min(best.relevance_variance.mean || 0, 0.1) * 5);
      return score > bestScore ? s : best;
    });

    lines.push(`### Recommendation`);
    lines.push(
      `Based on the composite of utilization × crux quality ÷ relevance variance, ` +
      `**maxTotal = ${bestLevel.level}** appears optimal for this topic and model.`,
    );

    if (bestLevel.level < last.level) {
      lines.push(
        `The current default (35) may be overshooting. Consider reducing to ${bestLevel.level} ` +
        `and monitoring calibration metrics for regression.`,
      );
    }
  }

  lines.push('');
  lines.push('### Caveats');
  lines.push('- Results are specific to this topic and model. Repeat with diverse topics before generalizing.');
  lines.push('- Small N per level — treat as directional signal, not definitive proof.');
  lines.push('- Stochastic LLM output means individual runs vary. Focus on trends across levels, not single points.');
  lines.push('- Utilization measures citation frequency, not attention. An uncited node may still influence reasoning.');
  lines.push('');

  // Raw data summary
  lines.push('## Per-Run Data');
  lines.push('');
  lines.push(`| Level | Floor | Rep | Rounds | Util | Primary | Crux | Mapped | API | Duration |`);
  lines.push(`|-------|-------|-----|--------|------|---------|------|--------|-----|----------|`);
  for (const r of data.runs.sort((a, b) => a.level - b.level || a.floor - b.floor || a.rep - b.rep)) {
    if (r.error) {
      lines.push(`| ${r.level} | ${r.floor} | ${r.rep} | ERROR | — | — | — | — | — | ${(r.duration_ms / 1000).toFixed(0)}s |`);
    } else {
      lines.push(
        `| ${r.level} | ${r.floor} | ${r.rep} | ${r.rounds} ` +
        `| ${pct(r.avg_utilization_rate)} ` +
        `| ${pct(r.avg_primary_utilization)} ` +
        `| ${pct(r.crux_addressed_ratio)} ` +
        `| ${pct(r.taxonomy_mapped_ratio)} ` +
        `| ${r.total_api_calls} ` +
        `| ${(r.duration_ms / 1000).toFixed(0)}s |`,
      );
    }
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  // Analyze-only mode: load existing results
  if (config.analyzeOnly) {
    console.log(`\n  Analyzing ${config.analyzeOnly.length} result file(s)...\n`);
    const allRuns: RunResult[] = [];
    let lastConfig: ExperimentData['config'] | null = null;

    for (const filePath of config.analyzeOnly) {
      const data: ExperimentData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Backfill floor=3 for runs from older experiments that lacked it
      for (const run of data.runs) {
        if (run.floor == null) run.floor = 3;
      }
      if (!data.config.floors) data.config.floors = [3];
      allRuns.push(...data.runs);
      lastConfig = data.config;
    }

    const merged: ExperimentData = {
      experiment_id: 'merged-analysis',
      timestamp: new Date().toISOString(),
      config: lastConfig ?? { levels: [], reps: 0, topic: '', model: '', pacing: '' },
      runs: allRuns,
    };

    const report = generateReport(merged);
    console.log(report);

    const reportPath = path.join(RESULTS_DIR, `injection-analysis-${Date.now()}.md`);
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`\n  Report written to: ${reportPath}`);
    return;
  }

  // Run mode
  preflight(config);

  const experimentId = `injection-${Date.now()}`;
  const runs: RunResult[] = [];

  // Randomize run order to avoid systematic bias (e.g., API warming, rate limits)
  const schedule: { level: number; floor: number; rep: number }[] = [];
  for (const level of config.levels) {
    for (const floor of config.floors) {
      // Skip infeasible combinations where floor × 3 > maxTotal
      if (floor * 3 > level) continue;
      for (let rep = 1; rep <= config.reps; rep++) {
        schedule.push({ level, floor, rep });
      }
    }
  }
  // Fisher-Yates shuffle
  for (let i = schedule.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [schedule[i], schedule[j]] = [schedule[j], schedule[i]];
  }

  console.log(`  Run order (randomized): ${schedule.map(s => `L${s.level}F${s.floor}R${s.rep}`).join(', ')}\n`);

  for (let i = 0; i < schedule.length; i++) {
    const { level, floor, rep } = schedule[i];
    console.log(`\n  [${ i + 1}/${schedule.length}] Level=${level} Floor=${floor} Rep=${rep}`);
    console.log(`  ${'─'.repeat(50)}`);

    const result = await runDebate(level, floor, rep, config);
    runs.push(result);

    if (result.error) {
      console.log(`  ✗ FAILED: ${result.error.slice(0, 120)}`);
    } else {
      console.log(`  ✓ Done: ${result.rounds} rounds, util=${pct(result.avg_utilization_rate)}, crux=${pct(result.crux_addressed_ratio)}`);
    }

    // Throttle between runs to avoid rate limits
    if (i < schedule.length - 1) {
      console.log('  Waiting 5s before next run...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Save raw data
  const data: ExperimentData = {
    experiment_id: experimentId,
    timestamp: new Date().toISOString(),
    config: {
      levels: config.levels,
      floors: config.floors,
      reps: config.reps,
      topic: config.topic,
      model: config.model,
      pacing: config.pacing,
    },
    runs,
  };

  const dataPath = path.join(RESULTS_DIR, `injection-experiment-${experimentId}.json`);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`\n  Raw data: ${dataPath}`);

  // Generate report
  const report = generateReport(data);
  const reportPath = path.join(RESULTS_DIR, `injection-experiment-${experimentId}.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`  Report: ${reportPath}`);

  // Print summary to console
  console.log('\n' + report);
}

main().catch((err) => {
  console.error(`\nExperiment failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
