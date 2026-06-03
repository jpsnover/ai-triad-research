#!/usr/bin/env npx tsx
// Retry rate monitor for t/307 — runs 3 debates and analyzes redraft retry rate.
// Usage: npx tsx research/comp-linguist/scripts/retry-rate-monitor.ts [--skip-debates] [--model gemini-2.5-flash]

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESULTS_DIR = path.resolve(__dirname, '..', 'results', 'retry-monitor');

const TOPICS = [
  'Should open-source AI models be subject to the same safety requirements as proprietary ones, or does openness itself provide a safety benefit through transparency?',
  'Is the concentration of AI compute among a handful of hyperscalers a threat to democratic governance, or a necessary efficiency for safe deployment?',
  'Will AI-generated content overwhelm human epistemic capacity within five years, or are current concerns overstated based on historical media panics?',
];

interface RetryStats {
  debateId: string;
  topic: string;
  totalTurns: number;
  retriedTurns: number;
  retryRate: number;
  triggerDistribution: Record<string, number>;
  perTurnDetails: { entryId: string; speaker: string; attempts: number; hints: string[][] }[];
}

function parseArgs(): { skipDebates: boolean; model: string } {
  const args = process.argv.slice(2);
  const skipDebates = args.includes('--skip-debates');
  const modelIdx = args.indexOf('--model');
  const model = modelIdx >= 0 && args[modelIdx + 1] ? args[modelIdx + 1] : 'gemini-2.5-flash';
  return { skipDebates, model };
}

function runDebate(topic: string, index: number, model: string): string {
  const outputDir = path.join(RESULTS_DIR, `debate-${index + 1}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const config = {
    topic,
    name: `retry-monitor-${index + 1}`,
    model,
    useAdaptiveStaging: true,
    pacing: 'tight',
    outputDir,
    outputFormat: 'json',
  };

  const configPath = path.join(outputDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`\n--- Debate ${index + 1}/3 ---`);
  console.log(`Topic: ${topic.substring(0, 80)}...`);
  console.log(`Model: ${model}`);
  console.log(`Output: ${outputDir}`);

  try {
    execSync(
      `npx tsx lib/debate/cli.ts --config "${configPath}"`,
      { cwd: REPO_ROOT, stdio: 'inherit', timeout: 20 * 60 * 1000 },
    );
  } catch (e: any) {
    console.error(`Debate ${index + 1} failed: ${e.message}`);
  }

  return outputDir;
}

function analyzeDebate(outputDir: string, topic: string): RetryStats | null {
  const debateFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('-debate.json'));
  if (debateFiles.length === 0) {
    console.error(`No debate JSON found in ${outputDir}`);
    return null;
  }

  const raw = fs.readFileSync(path.join(outputDir, debateFiles[0]), 'utf-8');
  const session = JSON.parse(raw);

  if (!session.turn_validations) {
    console.warn(`No turn_validations in ${debateFiles[0]} — validation may be disabled`);
    return null;
  }

  const validations = session.turn_validations as Record<string, { attempts: any[]; final: any }>;
  const transcript = session.transcript as any[];

  const speakerMap: Record<string, string> = {};
  for (const entry of transcript) {
    if (entry.id && entry.speaker) speakerMap[entry.id] = entry.speaker;
  }

  const totalTurns = Object.keys(validations).length;
  let retriedTurns = 0;
  const triggerDist: Record<string, number> = {};
  const perTurnDetails: RetryStats['perTurnDetails'] = [];

  for (const [entryId, trail] of Object.entries(validations)) {
    const attempts = trail.attempts;
    if (attempts.length > 1) {
      retriedTurns++;

      const allHints: string[][] = attempts.map((a: any) => a.validation?.repairHints ?? []);
      const firstHints = allHints[0] ?? [];
      for (const hint of firstHints) {
        const key = classifyTrigger(hint);
        triggerDist[key] = (triggerDist[key] ?? 0) + 1;
      }

      perTurnDetails.push({
        entryId,
        speaker: speakerMap[entryId] ?? 'unknown',
        attempts: attempts.length,
        hints: allHints,
      });
    }
  }

  return {
    debateId: session.id,
    topic,
    totalTurns,
    retriedTurns,
    retryRate: totalTurns > 0 ? retriedTurns / totalTurns : 0,
    triggerDistribution: triggerDist,
    perTurnDetails,
  };
}

function classifyTrigger(hint: string): string {
  const lower = hint.toLowerCase();
  if (lower.includes('abstract') || lower.includes('specificity') || lower.includes('concrete')) return 'abstract_claims';
  if (lower.includes('hedge') || lower.includes('hedging')) return 'hedge_density';
  if (lower.includes('repeat') || lower.includes('recycl')) return 'repetition';
  if (lower.includes('move_type') || lower.includes('move type')) return 'move_types';
  if (lower.includes('paragraph')) return 'paragraph_count';
  if (lower.includes('taxonomy') || lower.includes('node')) return 'taxonomy_ref';
  if (lower.includes('hardcoded boundary')) return 'hardcoded_boundary';
  if (lower.includes('softcoded') && lower.includes('evidence')) return 'softcoded_evidence';
  if (lower.includes('duplication') || lower.includes('duplicat')) return 'duplication';
  return 'other';
}

function generateReport(results: RetryStats[]): string {
  const valid = results.filter(r => r !== null) as RetryStats[];
  if (valid.length === 0) return '# Retry Rate Monitor — No valid results\n';

  const totalTurns = valid.reduce((s, r) => s + r.totalTurns, 0);
  const totalRetried = valid.reduce((s, r) => s + r.retriedTurns, 0);
  const overallRate = totalTurns > 0 ? totalRetried / totalTurns : 0;

  const allTriggers: Record<string, number> = {};
  for (const r of valid) {
    for (const [k, v] of Object.entries(r.triggerDistribution)) {
      allTriggers[k] = (allTriggers[k] ?? 0) + v;
    }
  }

  const baseline = 0.30;
  const verdict = overallRate < 0.10 ? 'PASS — specificity fix effective, no further action needed'
    : overallRate < 0.20 ? 'PARTIAL — partial improvement, may need stronger instruction'
    : overallRate < 0.25 ? 'MARGINAL — near threshold, monitor closely'
    : 'FAIL — specificity fix insufficient, escalate';

  let md = `# Retry Rate Monitor — t/307 Results\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Debates analyzed:** ${valid.length}\n`;
  md += `**Total turns:** ${totalTurns}\n`;
  md += `**Retried turns:** ${totalRetried}\n`;
  md += `**Overall retry rate:** ${(overallRate * 100).toFixed(1)}% (baseline: ${(baseline * 100).toFixed(0)}%)\n`;
  md += `**Verdict:** ${verdict}\n\n`;

  md += `## Per-Debate Breakdown\n\n`;
  md += `| # | Turns | Retried | Rate | Topic |\n`;
  md += `|---|-------|---------|------|-------|\n`;
  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    md += `| ${i + 1} | ${r.totalTurns} | ${r.retriedTurns} | ${(r.retryRate * 100).toFixed(1)}% | ${r.topic.substring(0, 60)}... |\n`;
  }

  if (Object.keys(allTriggers).length > 0) {
    md += `\n## Trigger Distribution\n\n`;
    md += `| Trigger | Count | % |\n`;
    md += `|---------|-------|---|\n`;
    const sorted = Object.entries(allTriggers).sort((a, b) => b[1] - a[1]);
    for (const [trigger, count] of sorted) {
      md += `| ${trigger} | ${count} | ${(count / totalRetried * 100).toFixed(0)}% |\n`;
    }
  }

  if (valid.some(r => r.perTurnDetails.length > 0)) {
    md += `\n## Retried Turn Details\n\n`;
    for (const r of valid) {
      if (r.perTurnDetails.length === 0) continue;
      md += `### Debate: ${r.topic.substring(0, 60)}...\n\n`;
      for (const t of r.perTurnDetails) {
        md += `- **${t.speaker}** (${t.attempts} attempts): ${t.hints[0]?.join('; ').substring(0, 120) || 'no hints recorded'}\n`;
      }
      md += '\n';
    }
  }

  return md;
}

async function main() {
  const { skipDebates, model } = parseArgs();

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  let outputDirs: string[];

  if (skipDebates) {
    console.log('Skipping debate runs — analyzing existing results...');
    outputDirs = fs.readdirSync(RESULTS_DIR)
      .filter(d => d.startsWith('debate-'))
      .map(d => path.join(RESULTS_DIR, d))
      .filter(d => fs.statSync(d).isDirectory());
  } else {
    console.log(`Running ${TOPICS.length} debates with model: ${model}...`);
    outputDirs = TOPICS.map((topic, i) => runDebate(topic, i, model));
  }

  console.log('\n--- Analyzing results ---');
  const results = outputDirs.map((dir, i) => {
    const configFile = path.join(dir, 'config.json');
    const topic = fs.existsSync(configFile)
      ? JSON.parse(fs.readFileSync(configFile, 'utf-8')).topic ?? TOPICS[i] ?? 'unknown'
      : TOPICS[i] ?? 'unknown';
    return analyzeDebate(dir, topic);
  }).filter((r): r is RetryStats => r !== null);

  const report = generateReport(results);

  const reportPath = path.join(RESULTS_DIR, 'retry-rate-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);

  const jsonPath = path.join(RESULTS_DIR, 'retry-rate-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Raw data written to: ${jsonPath}`);

  console.log('\n' + report);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
