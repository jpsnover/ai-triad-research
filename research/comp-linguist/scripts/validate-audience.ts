#!/usr/bin/env npx tsx
/**
 * Audience directive validation script (t/345, completes t/334).
 * Runs 2 debates with non-default audiences and validates:
 *   1. Character personality persistence
 *   2. Register adaptation between audiences
 *   3. De-artifacting tell suppression
 *   4. Speaker identification blind test (LLM-based)
 *
 * Usage: npx tsx research/comp-linguist/scripts/validate-audience.ts [--model <model>] [--skip-debates] [--output-dir <path>]
 *   --model          AI model to use (default: gemini-2.5-flash)
 *   --skip-debates   Skip debate runs, analyze existing output in --output-dir
 *   --output-dir     Directory for debate output (default: ./debates/audience-validation)
 *   --skip-blind     Skip LLM-based blind speaker ID test (saves API calls)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ── Types ───────────────────────────────────────────────

interface TranscriptEntry {
  type: string;
  speaker: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

interface DebateSession {
  id: string;
  audience?: string;
  transcript: TranscriptEntry[];
  topic: { final: string };
}

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  details: string;
  evidence: Record<string, unknown>;
}

interface ValidationReport {
  timestamp: string;
  model: string;
  debates: { audience: string; id: string; statements: number }[];
  checks: CheckResult[];
  overall: 'PASS' | 'FAIL';
}

// ── CLI args ────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    model: get('--model') ?? process.env.AI_MODEL ?? 'gemini-2.5-flash',
    skipDebates: args.includes('--skip-debates'),
    skipBlind: args.includes('--skip-blind'),
    outputDir: path.resolve(get('--output-dir') ?? './debates/audience-validation'),
  };
}

// ── Debate runner ───────────────────────────────────────

function runDebate(audience: string, model: string, outputDir: string): DebateSession {
  const slug = `audience-val-${audience}`;
  const configPath = path.join(outputDir, `${slug}-config.json`);
  const config = {
    topic: 'Should frontier AI labs be required to obtain government licenses before training models above a compute threshold?',
    audience,
    model,
    rounds: 3,
    useAdaptiveStaging: true,
    pacing: 'tight',
    maxTotalRounds: 12,
    allowEarlyTermination: true,
    slug,
    outputDir,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  log(`Running debate with audience=${audience}, model=${model}...`);
  const result = execSync(
    `npx tsx lib/debate/cli.ts --config "${configPath}"`,
    { cwd: REPO_ROOT, timeout: 1_800_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const parsed = JSON.parse(result.trim().split('\n').pop()!);
  if (!parsed.success) throw new Error(`Debate failed: ${parsed.error}`);

  const sessionPath = parsed.files.transcript ?? parsed.files.debate;
  return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
}

function loadExistingDebate(audience: string, outputDir: string): DebateSession {
  const slug = `audience-val-${audience}`;
  const jsonPath = path.join(outputDir, `${slug}-debate.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`No existing debate found at ${jsonPath}. Run without --skip-debates first.`);
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
}

// ── Statement extraction ────────────────────────────────

function getStatements(session: DebateSession): TranscriptEntry[] {
  return session.transcript.filter(e => e.type === 'statement' && e.content);
}

function getStatementsBySpeaker(session: DebateSession): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const e of getStatements(session)) {
    (result[e.speaker] ??= []).push(e.content!);
  }
  return result;
}

// ── Check 1: Character personality persistence ──────────

const PERSONALITY_MARKERS: Record<string, { positive: string[]; description: string }> = {
  accelerationist: {
    positive: [
      'deploy', 'ship', 'cost of inaction', 'cost of delay', 'opportunity',
      'innovation', 'democratiz', 'permissionless', 'experiment', 'faster',
      'liberat', 'empowerment', 'billion', 'startup', 'iterate', 'progress',
      'competitive', 'stagnation', 'bureaucra',
    ],
    description: 'Impatient, progress-driven, frames delay as moral cost',
  },
  safetyist: {
    positive: [
      'safeguard', 'guardrail', 'enforcement', 'accountability', 'precedent',
      'institutional', 'oversight', 'structural', 'systemic', 'certif',
      'audit', 'compliance', 'precaution', 'catastroph', 'irreversib',
      'governance', 'regulat', 'framework', 'mechanism',
    ],
    description: 'Measured, layered, precautionary, institutional',
  },
  skeptic: {
    positive: [
      'who pays', 'who profits', 'who decides', 'labor', 'worker',
      'infrastructure', 'material', 'supply chain', 'data center',
      'ground', 'actually', 'narrative', 'incentive', 'follow the money',
      'power', 'concentrate', 'lobby', 'capture', 'on the ground',
    ],
    description: 'Grounding, material, power-accountability, demystifying',
  },
};

function checkPersonalityPersistence(sessions: DebateSession[]): CheckResult {
  const evidence: Record<string, Record<string, { hits: number; total_words: number; density: number }>> = {};
  let allPass = true;

  for (const session of sessions) {
    const byAudience: Record<string, Record<string, { hits: number; total_words: number; density: number }>> = {};
    const bySpeaker = getStatementsBySpeaker(session);

    for (const [speaker, statements] of Object.entries(bySpeaker)) {
      const markers = PERSONALITY_MARKERS[speaker];
      if (!markers) continue;

      const allText = statements.join(' ').toLowerCase();
      const words = allText.split(/\s+/).length;
      let hits = 0;
      for (const marker of markers.positive) {
        const regex = new RegExp(marker, 'gi');
        const matches = allText.match(regex);
        if (matches) hits += matches.length;
      }

      const density = hits / (words / 1000);
      byAudience[speaker] = { hits, total_words: words, density: Math.round(density * 10) / 10 };

      // Require at least 3 marker hits per 1000 words
      if (density < 3) allPass = false;
    }

    evidence[session.audience ?? 'unknown'] = byAudience;
  }

  return {
    name: 'Character Personality Persistence',
    status: allPass ? 'PASS' : 'FAIL',
    details: allPass
      ? 'All characters maintained personality markers across both audiences'
      : 'One or more characters showed weak personality signal (<3 markers per 1000 words)',
    evidence,
  };
}

// ── Check 2: Register adaptation ────────────────────────

function computeRegisterMetrics(statements: string[]) {
  const allText = statements.join(' ');
  const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = allText.split(/\s+/).filter(w => w.length > 0);

  const avgWordLength = words.reduce((s, w) => s + w.replace(/[^a-zA-Z]/g, '').length, 0) / words.length;
  const avgSentenceLength = words.length / sentences.length;
  const longWords = words.filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 8).length;
  const longWordRatio = longWords / words.length;

  // Jargon markers for academic register
  const academicTerms = [
    'epistem', 'ontolog', 'hermeneutic', 'normative', 'heuristic',
    'axiom', 'praxis', 'paradigm', 'methodolog', 'theoretical',
    'empirical', 'conceptual', 'analytical', 'framework', 'systematic',
    'discourse', 'dialectic', 'synthesis', 'taxonomy', 'hypothesis',
  ];
  const academicHits = academicTerms.reduce((count, term) => {
    const regex = new RegExp(term, 'gi');
    return count + (allText.match(regex)?.length ?? 0);
  }, 0);

  // Accessibility markers for general public register
  const accessibilityTerms = [
    'everyday', 'imagine', 'picture this', 'in other words',
    'basically', 'simply put', 'think of it', 'for example',
    'real life', 'your', 'our', 'people like',
  ];
  const accessHits = accessibilityTerms.reduce((count, term) => {
    const regex = new RegExp(term, 'gi');
    return count + (allText.match(regex)?.length ?? 0);
  }, 0);

  return {
    avgWordLength: Math.round(avgWordLength * 100) / 100,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    longWordRatio: Math.round(longWordRatio * 1000) / 1000,
    academicTermDensity: Math.round((academicHits / (words.length / 1000)) * 10) / 10,
    accessibilityTermDensity: Math.round((accessHits / (words.length / 1000)) * 10) / 10,
    totalWords: words.length,
  };
}

function checkRegisterAdaptation(academic: DebateSession, general: DebateSession): CheckResult {
  const acStatements = getStatements(academic).map(e => e.content!);
  const gpStatements = getStatements(general).map(e => e.content!);

  const acMetrics = computeRegisterMetrics(acStatements);
  const gpMetrics = computeRegisterMetrics(gpStatements);

  // Academic should have higher vocabulary complexity than general public
  const wordLenDelta = acMetrics.avgWordLength - gpMetrics.avgWordLength;
  const sentLenDelta = acMetrics.avgSentenceLength - gpMetrics.avgSentenceLength;
  const longWordDelta = acMetrics.longWordRatio - gpMetrics.longWordRatio;

  // At least 2 of 3 complexity metrics should be higher for academic
  let higherCount = 0;
  if (wordLenDelta > 0) higherCount++;
  if (sentLenDelta > 0) higherCount++;
  if (longWordDelta > 0) higherCount++;

  const pass = higherCount >= 2;

  return {
    name: 'Register Adaptation',
    status: pass ? 'PASS' : 'FAIL',
    details: pass
      ? `Academic register is more complex on ${higherCount}/3 metrics`
      : `Academic register is NOT consistently more complex (only ${higherCount}/3 metrics higher). Audience directives may not be adapting register effectively.`,
    evidence: {
      academic_community: acMetrics,
      general_public: gpMetrics,
      deltas: {
        avg_word_length: Math.round(wordLenDelta * 100) / 100,
        avg_sentence_length: Math.round(sentLenDelta * 10) / 10,
        long_word_ratio: Math.round(longWordDelta * 1000) / 1000,
      },
    },
  };
}

// ── Check 3: De-artifacting tell suppression ────────────

const TELL_PATTERNS: {
  name: string;
  patterns: RegExp[];
  threshold: number;
  unit: string;
}[] = [
  {
    name: 'Formulaic Transitions',
    patterns: [
      /\bFurthermore\b/gi, /\bMoreover\b/gi, /\bIn conclusion\b/gi,
      /\bUltimately\b/gi, /\bIt is important to note\b/gi,
    ],
    threshold: 2,
    unit: 'per debate',
  },
  {
    name: 'Bureaucratic Register',
    patterns: [
      /\bmitigate\b/gi, /\brobust\b/gi, /\bleverage\b/gi,
      /\butilize\b/gi, /\bensure\b/gi,
    ],
    threshold: 3,
    unit: 'per debate',
  },
  {
    name: 'Performative Acknowledgment',
    patterns: [
      /correctly identifies/gi, /correctly notes/gi,
      /is well-founded/gi, /\bis valid\b/gi,
    ],
    threshold: 1,
    unit: 'per debate',
  },
  {
    name: 'Meta-Assertions',
    patterns: [
      /It is important to note/gi, /It is essential to/gi,
      /The business-relevant conclusion is/gi,
      /My position is consistent/gi, /I want to emphasize/gi,
    ],
    threshold: 2,
    unit: 'per debate',
  },
  {
    name: 'Empty Intensifiers (banned)',
    patterns: [
      /\bcrucial\b/gi, /\bessential\b/gi, /\bsignificant\b/gi,
    ],
    threshold: 2,
    unit: 'per debate',
  },
];

function checkIntensifierFrequency(statements: string[]): { speaker: string; word: string; count: number }[] {
  const violations: { speaker: string; word: string; count: number }[] = [];
  for (const text of statements) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 6);
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    for (const [word, count] of freq) {
      if (count > 4) violations.push({ speaker: '', word, count });
    }
  }
  return violations;
}

function checkTellSuppression(sessions: DebateSession[]): CheckResult {
  const findings: { audience: string; category: string; count: number; examples: string[] }[] = [];
  let totalViolations = 0;

  for (const session of sessions) {
    const statements = getStatements(session).map(e => e.content!);
    const allText = statements.join('\n\n');

    for (const tell of TELL_PATTERNS) {
      let count = 0;
      const examples: string[] = [];
      for (const pattern of tell.patterns) {
        const matches = allText.match(pattern);
        if (matches) {
          count += matches.length;
          if (examples.length < 3) examples.push(...matches.slice(0, 3 - examples.length));
        }
      }

      if (count > tell.threshold) {
        findings.push({
          audience: session.audience ?? 'unknown',
          category: tell.name,
          count,
          examples,
        });
        totalViolations++;
      }
    }

    // Intensifier frequency check
    const intViolations = checkIntensifierFrequency(statements);
    if (intViolations.length > 0) {
      findings.push({
        audience: session.audience ?? 'unknown',
        category: 'Intensifier Repetition (>4x per statement)',
        count: intViolations.length,
        examples: intViolations.slice(0, 3).map(v => `"${v.word}" x${v.count}`),
      });
      totalViolations++;
    }

    // Cross-speaker vocabulary contamination
    const bySpeaker = getStatementsBySpeaker(session);
    const speakerTerms: Record<string, Set<string>> = {};
    for (const [speaker, stmts] of Object.entries(bySpeaker)) {
      const terms = new Set<string>();
      for (const s of stmts) {
        const words = s.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(w => w.length >= 7);
        for (const w of words) terms.add(w);
      }
      speakerTerms[speaker] = terms;
    }

    const speakers = Object.keys(speakerTerms);
    if (speakers.length >= 2) {
      let sharedCount = 0;
      let totalUnique = 0;
      const allTerms = new Set<string>();
      for (const terms of Object.values(speakerTerms)) for (const t of terms) allTerms.add(t);
      totalUnique = allTerms.size;

      for (const term of allTerms) {
        const usedBy = speakers.filter(s => speakerTerms[s].has(term));
        if (usedBy.length >= 2) sharedCount++;
      }

      const sharedPct = totalUnique > 0 ? Math.round((sharedCount / totalUnique) * 100) : 0;
      if (sharedPct > 20) {
        findings.push({
          audience: session.audience ?? 'unknown',
          category: 'Cross-Speaker Vocabulary Contamination',
          count: sharedPct,
          examples: [`${sharedPct}% shared 7+ char terms across speakers (threshold: 20%)`],
        });
        totalViolations++;
      }
    }
  }

  const pass = totalViolations === 0;
  return {
    name: 'De-Artifacting Tell Suppression',
    status: pass ? 'PASS' : totalViolations <= 2 ? 'WARN' : 'FAIL',
    details: pass
      ? 'No tell category exceeded its threshold in either debate'
      : `${totalViolations} tell category violation(s) detected`,
    evidence: { findings, totalViolations },
  };
}

// ── Check 4: Speaker identification blind test ──────────

async function checkSpeakerIdentification(
  sessions: DebateSession[],
  model: string,
): Promise<CheckResult> {
  let correct = 0;
  let total = 0;
  const results: { audience: string; actual: string; predicted: string; correct: boolean }[] = [];

  // Dynamically import the AI adapter
  const { createCLIAdapter } = await import(path.join(REPO_ROOT, 'lib/debate/aiAdapter.js'));
  const adapter = createCLIAdapter(REPO_ROOT);

  for (const session of sessions) {
    const statements = getStatements(session);
    // Sample up to 6 statements per debate (2 per speaker if available)
    const sampled: TranscriptEntry[] = [];
    const bySpeaker = new Map<string, TranscriptEntry[]>();
    for (const s of statements) {
      const arr = bySpeaker.get(s.speaker) ?? [];
      arr.push(s);
      bySpeaker.set(s.speaker, arr);
    }
    for (const [, stmts] of bySpeaker) {
      sampled.push(...stmts.slice(0, 2));
    }

    for (const entry of sampled) {
      const prompt = `You are evaluating a multi-agent debate system. Below is a statement from one of three debate characters:
- Accelerationist: frames AI progress as moral imperative, impatient with delay, uses startup/deployment language
- Safetyist: frames AI governance as civilizational defense, methodical, institutional, precedent-driven
- Skeptic: grounding realist, challenges both sides, focuses on material reality, labor, infrastructure, power

The statement (with speaker label removed):
"""
${entry.content!.slice(0, 1500)}
"""

Based ONLY on the rhetorical style, vocabulary, reasoning pattern, and argument framing, which character most likely wrote this? Respond with exactly one word: Accelerationist, Safetyist, or Skeptic.`;

      try {
        const response = await adapter.chat(model, [
          { role: 'user', content: prompt },
        ], { temperature: 0 });

        const predicted = response.trim().toLowerCase();
        const actual = entry.speaker;
        const normalizedPredicted =
          predicted.includes('accelerationist') ? 'accelerationist' :
          predicted.includes('safetyist') ? 'safetyist' :
          predicted.includes('skeptic') ? 'skeptic' : 'unknown';

        const isCorrect = normalizedPredicted === actual;
        results.push({
          audience: session.audience ?? 'unknown',
          actual,
          predicted: normalizedPredicted,
          correct: isCorrect,
        });
        if (isCorrect) correct++;
        total++;
      } catch (err) {
        log(`  Speaker ID call failed: ${err instanceof Error ? err.message : err}`);
        total++;
      }
    }
  }

  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const pass = accuracy >= 80;

  return {
    name: 'Speaker Identification Blind Test',
    status: pass ? 'PASS' : 'FAIL',
    details: `${accuracy}% accuracy (${correct}/${total} correct). Target: >=80%`,
    evidence: { accuracy, correct, total, results },
  };
}

// ── Report generation ───────────────────────────────────

function generateReport(
  model: string,
  sessions: DebateSession[],
  checks: CheckResult[],
): ValidationReport {
  const debates = sessions.map(s => ({
    audience: s.audience ?? 'unknown',
    id: s.id,
    statements: getStatements(s).length,
  }));

  const overall = checks.every(c => c.status === 'PASS' || c.status === 'WARN' || c.status === 'SKIP')
    ? 'PASS' : 'FAIL';

  return {
    timestamp: new Date().toISOString(),
    model,
    debates,
    checks,
    overall,
  };
}

// ── Logging ─────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[audience-val] ${msg}\n`);
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const { model, skipDebates, skipBlind, outputDir } = parseArgs();

  log(`Model: ${model}`);
  log(`Output: ${outputDir}`);
  log(`Skip debates: ${skipDebates}, Skip blind test: ${skipBlind}`);

  // Step 1: Run or load debates
  const audiences = ['academic_community', 'general_public'] as const;
  const sessions: DebateSession[] = [];

  for (const audience of audiences) {
    if (skipDebates) {
      log(`Loading existing ${audience} debate...`);
      sessions.push(loadExistingDebate(audience, outputDir));
    } else {
      sessions.push(runDebate(audience, model, outputDir));
    }
  }

  const [academic, general] = sessions;
  log(`Academic debate: ${getStatements(academic).length} statements`);
  log(`General debate: ${getStatements(general).length} statements`);

  // Step 2: Run checks
  const checks: CheckResult[] = [];

  log('Check 1: Character personality persistence...');
  checks.push(checkPersonalityPersistence(sessions));
  log(`  → ${checks[checks.length - 1].status}`);

  log('Check 2: Register adaptation...');
  checks.push(checkRegisterAdaptation(academic, general));
  log(`  → ${checks[checks.length - 1].status}`);

  log('Check 3: De-artifacting tell suppression...');
  checks.push(checkTellSuppression(sessions));
  log(`  → ${checks[checks.length - 1].status}`);

  if (skipBlind) {
    log('Check 4: Speaker identification — SKIPPED (--skip-blind)');
    checks.push({
      name: 'Speaker Identification Blind Test',
      status: 'SKIP',
      details: 'Skipped via --skip-blind flag',
      evidence: {},
    });
  } else {
    log('Check 4: Speaker identification blind test (LLM-based)...');
    checks.push(await checkSpeakerIdentification(sessions, model));
    log(`  → ${checks[checks.length - 1].status}`);
  }

  // Step 3: Generate report
  const report = generateReport(model, sessions, checks);

  // Write report
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`Report written to: ${reportPath}`);

  // Write markdown summary
  const mdLines = [
    `# Audience Directive Validation Report`,
    '',
    `**Date:** ${report.timestamp}`,
    `**Model:** ${report.model}`,
    `**Overall:** ${report.overall}`,
    '',
    '## Debates',
    '',
    ...report.debates.map(d => `- **${d.audience}**: ${d.statements} statements (ID: ${d.id})`),
    '',
    '## Checks',
    '',
    ...report.checks.map(c => [
      `### ${c.name}: ${c.status}`,
      '',
      c.details,
      '',
      '```json',
      JSON.stringify(c.evidence, null, 2).slice(0, 2000),
      '```',
      '',
    ].join('\n')),
  ];

  const mdPath = path.join(outputDir, 'validation-report.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'));
  log(`Markdown report: ${mdPath}`);

  // Print summary
  log('');
  log('═══════════════════════════════════════════');
  log(`  OVERALL: ${report.overall}`);
  log('───────────────────────────────────────────');
  for (const c of report.checks) {
    log(`  ${c.status.padEnd(4)} │ ${c.name}`);
    log(`       │ ${c.details.slice(0, 80)}`);
  }
  log('═══════════════════════════════════════════');

  process.exit(report.overall === 'PASS' ? 0 : 1);
}

main().catch(err => {
  log(`FATAL: ${err instanceof Error ? err.message : err}`);
  if (err instanceof Error && err.stack) log(err.stack);
  process.exit(2);
});
