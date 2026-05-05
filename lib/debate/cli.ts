#!/usr/bin/env npx tsx
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CLI entry point for the headless debate runner.
 * Reads config from --config <path>, runs a full debate, writes output files.
 * Prints result JSON to stdout for PowerShell cmdlet consumption.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCLIAdapter } from './aiAdapter.js';
import { resolveRepoRoot, loadTaxonomy, loadSourceContent, fetchUrlContent, loadConflicts, loadVocabulary } from './taxonomyLoader.js';
import { DebateEngine } from './debateEngine.js';
import type { DebateConfig } from './debateEngine.js';
import type { DebateSourceType, PoverId, DebateAudience } from './types.js';
import { POVER_INFO, DEBATE_AUDIENCES, POV_KEYS } from './types.js';
import { formatSituationDebateContext } from './prompts.js';
import { generateSlug, formatDebateMarkdown, buildDiagnosticsOutput, buildHarvestOutput } from './formatters.js';
import { ActionableError } from './errors.js';

// ── CLI Config schema ────────────────────────────────────

interface CLIConfig {
  topic?: string;
  name?: string;
  docPath?: string;
  url?: string;
  situationId?: string;
  activePovers?: string[];
  model?: string;
  evaluatorModel?: string;
  rounds?: number;
  responseLength?: string;
  protocolId?: string;
  enableClarification?: boolean;
  enableProbing?: boolean;
  probingInterval?: number;
  outputDir?: string;
  outputFormat?: string;
  slug?: string;
  apiKey?: string;
  temperature?: number;
  audience?: string;
  useAdaptiveStaging?: boolean;
  pacing?: 'tight' | 'moderate' | 'thorough';
  maxTotalRounds?: number;
  allowEarlyTermination?: boolean;
}

// ── Main ─────────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[debate-cli] ${msg}\n`);
}

interface ParsedArgs {
  configPath: string;
  disableTurnValidation: boolean;
  maxTurnRetries?: 0 | 1 | 2;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  let configPath: string | undefined;
  const cfgIdx = args.indexOf('--config');
  if (cfgIdx >= 0 && args[cfgIdx + 1]) configPath = args[cfgIdx + 1];
  else if (args.includes('--stdin')) configPath = '-';

  if (!configPath) {
    console.error('Usage: npx tsx lib/debate/cli.ts --config <path.json> [--no-turn-validation] [--max-turn-retries 0|1|2]');
    process.exit(1);
  }

  const disableTurnValidation = args.includes('--no-turn-validation');

  let maxTurnRetries: 0 | 1 | 2 | undefined;
  const retryIdx = args.indexOf('--max-turn-retries');
  if (retryIdx >= 0 && args[retryIdx + 1]) {
    const raw = args[retryIdx + 1];
    const n = Number(raw);
    if (n !== 0 && n !== 1 && n !== 2) {
      console.error(`--max-turn-retries must be 0, 1, or 2 (got '${raw}').`);
      process.exit(1);
    }
    maxTurnRetries = n as 0 | 1 | 2;
  }

  return { configPath, disableTurnValidation, maxTurnRetries };
}

async function main(): Promise<void> {
  const { configPath, disableTurnValidation, maxTurnRetries } = parseArgs();
  let configText: string;

  if (configPath === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    configText = Buffer.concat(chunks).toString('utf-8');
  } else {
    const resolvedConfig = path.resolve(configPath);
    if (!fs.existsSync(resolvedConfig)) {
      throw new ActionableError({
        goal: 'Load debate configuration',
        problem: `Config file not found: ${resolvedConfig}`,
        location: 'cli.main',
        nextSteps: [
          'Provide a valid JSON config file path via --config <path>',
          `Verify the file exists at: ${resolvedConfig}`,
          'Check for typos in the file path',
        ],
      });
    }
    try {
      configText = fs.readFileSync(resolvedConfig, 'utf-8');
    } catch (err) {
      throw new ActionableError({
        goal: 'Load debate configuration',
        problem: `Failed to read config file ${resolvedConfig}: ${err instanceof Error ? err.message : err}`,
        location: 'cli.main',
        nextSteps: [
          'Check that you have read permissions on the file',
          `Verify the file is not locked by another process`,
        ],
        innerError: err,
      });
    }
  }

  let config: CLIConfig;
  try {
    config = JSON.parse(configText);
  } catch (err) {
    throw new ActionableError({
      goal: 'Parse debate configuration',
      problem: `Config file contains invalid JSON: ${err instanceof Error ? err.message : err}`,
      location: 'cli.main',
      nextSteps: [
        'Validate the config file with a JSON linter (e.g. jsonlint or VS Code)',
        `Check the first 200 chars for syntax errors: ${configText.slice(0, 200)}`,
        'Ensure no trailing commas, unquoted keys, or missing brackets',
      ],
      innerError: err,
    });
  }
  const startTime = Date.now();

  // Resolve repo root
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolveRepoRoot(__dirname);
  log(`Repo root: ${repoRoot}`);

  // Load taxonomy
  log('Loading taxonomy...');
  const taxonomy = loadTaxonomy(repoRoot);
  log(`Loaded: ${taxonomy.accelerationist.nodes.length} acc, ${taxonomy.safetyist.nodes.length} saf, ${taxonomy.skeptic.nodes.length} skp, ${taxonomy.situations.nodes.length} sit nodes`);

  // Load vocabulary for standardized term enforcement
  const vocab = loadVocabulary(repoRoot);
  log(`Vocabulary: ${vocab.standardized.length} standardized, ${vocab.colloquial.length} colloquial terms`);

  // Resolve topic source
  let topic = config.topic ?? '';
  let sourceType: DebateSourceType = 'topic';
  let sourceRef = '';
  let sourceContent = '';

  if (config.docPath) {
    sourceType = 'document';
    sourceRef = config.docPath;
    sourceContent = await loadSourceContent(config.docPath);
    if (!topic) topic = `Debate grounded in: ${path.basename(config.docPath)}`;
    log(`Loaded document: ${config.docPath} (${sourceContent.length} chars)`);
  } else if (config.url) {
    sourceType = 'url';
    sourceRef = config.url;
    sourceContent = await fetchUrlContent(config.url);
    if (!topic) topic = `Debate grounded in: ${config.url}`;
    log(`Fetched URL: ${config.url} (${sourceContent.length} chars)`);
  } else if (config.situationId) {
    sourceType = 'situations';
    sourceRef = config.situationId;
    const sitNode = taxonomy.situations.nodes.find(n => n.id === config.situationId);
    if (!sitNode) throw new ActionableError({
      goal: 'Load situation node for debate',
      problem: `Situation node not found: ${config.situationId}`,
      location: 'cli.main',
      nextSteps: [
        `Verify the situationId '${config.situationId}' exists in the taxonomy situations data`,
        'List available situation IDs with: jq ".[].id" <data-root>/taxonomy/situations.json',
        'Check for typos in the situationId field of your config',
      ],
    });

    // Build situation context
    const conflicts = loadConflicts(repoRoot);
    const conflictSummaries = conflicts
      .filter(c => c.linked_taxonomy_nodes?.includes(config.situationId!))
      .map(c => `${c.claim_label}: ${c.description}`)
      .slice(0, 5);

    const linkedNodeDescriptions: string[] = [];
    for (const linkedId of (sitNode.linked_nodes ?? []).slice(0, 10)) {
      for (const pov of POV_KEYS) {
        const node = taxonomy[pov].nodes.find(n => n.id === linkedId);
        if (node) linkedNodeDescriptions.push(`[${node.id}] ${node.label}: ${node.description.slice(0, 150)}`);
      }
    }

    sourceContent = formatSituationDebateContext({
      id: sitNode.id,
      label: sitNode.label,
      description: sitNode.description,
      interpretations: sitNode.interpretations,
      assumes: sitNode.graph_attributes?.assumes,
      steelmanVulnerability: typeof sitNode.graph_attributes?.steelman_vulnerability === 'string'
        ? sitNode.graph_attributes.steelman_vulnerability : undefined,
      linkedNodeDescriptions,
      conflictSummaries,
    });

    if (!topic) topic = `Situation: ${sitNode.label}`;
    log(`Loaded situation node: ${sitNode.id} — ${sitNode.label}`);
  }

  if (!topic) throw new ActionableError({
    goal: 'Determine debate topic',
    problem: 'No topic specified',
    location: 'cli.main',
    nextSteps: [
      'Add a "topic" field to your config JSON with the debate question or thesis',
      'Alternatively, provide "docPath", "url", or "situationId" to derive the topic from a source',
    ],
  });

  // Validate debaters
  const activePovers = (config.activePovers ?? ['prometheus', 'sentinel', 'cassandra']) as Exclude<PoverId, 'user'>[];
  if (activePovers.length < 2) throw new ActionableError({
    goal: 'Validate debate configuration',
    problem: `At least 2 debaters required, but only ${activePovers.length} specified`,
    location: 'cli.main',
    nextSteps: [
      'Add at least 2 entries to the "activePovers" array in your config',
      'Valid debaters: prometheus, sentinel, cassandra',
    ],
  });
  for (const p of activePovers) {
    if (!POVER_INFO[p]) throw new ActionableError({
      goal: 'Validate debate configuration',
      problem: `Unknown debater: ${p}`,
      location: 'cli.main',
      nextSteps: [
        `Replace '${p}' with one of: prometheus, sentinel, cassandra`,
        'Check the "activePovers" array in your config for typos',
      ],
    });
  }

  // Create adapter
  // Validate audience
  const validAudienceIds = DEBATE_AUDIENCES.map(a => a.id);
  const audience = config.audience
    ? (validAudienceIds.includes(config.audience as DebateAudience) ? config.audience as DebateAudience : (() => { throw new ActionableError({
        goal: 'Validate debate configuration',
        problem: `Unknown audience: ${config.audience}`,
        location: 'cli.main',
        nextSteps: [
          `Replace '${config.audience}' with one of: ${validAudienceIds.join(', ')}`,
          'Check the "audience" field in your config for typos',
        ],
      }); })())
    : undefined;

  const adapter = createCLIAdapter(repoRoot, config.apiKey);
  const model = config.model ?? process.env.AI_MODEL ?? 'gemini-2.5-flash';
  log(`Model: ${model}`);

  // Build engine config
  const engineConfig: DebateConfig = {
    topic,
    name: config.name,
    sourceType,
    sourceRef,
    sourceContent,
    activePovers,
    protocolId: config.protocolId ?? 'structured',
    model,
    evaluatorModel: config.evaluatorModel,
    rounds: config.rounds ?? 3,
    responseLength: (config.responseLength ?? 'medium') as 'brief' | 'medium' | 'detailed',
    enableClarification: config.enableClarification,
    enableProbing: config.enableProbing,
    probingInterval: config.probingInterval ?? 2,
    temperature: config.temperature,
    turnValidation: {
      enabled: !disableTurnValidation,
      ...(maxTurnRetries !== undefined ? { maxRetries: maxTurnRetries } : {}),
    },
    appVersion: (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../taxonomy-editor/package.json'), 'utf-8')).version; } catch { return undefined; } })(),
    audience,
    vocabulary: vocab.standardized.length > 0
      ? { standardizedTerms: vocab.standardized as import('../dictionary/types').StandardizedTerm[], colloquialTerms: vocab.colloquial as import('../dictionary/types').ColloquialTerm[] }
      : undefined,
    useAdaptiveStaging: config.useAdaptiveStaging,
    pacing: config.pacing,
    maxTotalRounds: config.maxTotalRounds,
    allowEarlyTermination: config.allowEarlyTermination,
  };

  // Run debate
  log(`Starting debate: "${topic.slice(0, 80)}..." with ${activePovers.join(', ')}, ${engineConfig.useAdaptiveStaging ? `adaptive (${config.pacing ?? 'moderate'})` : `${engineConfig.rounds} rounds`}`);
  const engine = new DebateEngine(engineConfig, adapter, taxonomy);
  const session = await engine.run((p) => {
    log(`[${p.phase}] ${p.speaker ? `${p.speaker}: ` : ''}${p.message}`);
  });

  // Stamp origin metadata
  session.origin = {
    mode: 'cli',
    command: `npx tsx lib/debate/cli.ts --config ${configPath}${disableTurnValidation ? ' --no-turn-validation' : ''}${maxTurnRetries !== undefined ? ` --max-turn-retries ${maxTurnRetries}` : ''}`,
    config_summary: {
      ...(config.topic ? { topic: config.topic } : {}),
      ...(config.docPath ? { docPath: config.docPath } : {}),
      ...(config.url ? { url: config.url } : {}),
      ...(config.name ? { name: config.name } : {}),
      model: config.model ?? model,
      rounds: config.rounds ?? 3,
      protocol: config.protocolId ?? 'structured',
      audience: config.audience,
      activePovers: config.activePovers,
      responseLength: config.responseLength ?? 'medium',
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
      ...(config.useAdaptiveStaging ? { adaptiveStaging: true, pacing: config.pacing ?? 'moderate' } : {}),
    },
  };

  // Generate outputs
  const slug = config.slug ?? generateSlug(config.name ?? topic);
  const outputDir = path.resolve(config.outputDir ?? './debates');
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    throw new ActionableError({
      goal: 'Create debate output directory',
      problem: `Failed to create output directory '${outputDir}': ${err instanceof Error ? err.message : err}`,
      location: 'cli.main',
      nextSteps: [
        `Check that the parent directory of '${outputDir}' exists`,
        'Verify you have write permissions to the target location',
        'Try specifying a different "outputDir" in your config',
      ],
      innerError: err,
    });
  }

  const outputFormat = config.outputFormat ?? 'json';

  function writeOutput(filePath: string, content: string, description: string): void {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      log(`Wrote ${description}: ${filePath}`);
    } catch (err) {
      throw new ActionableError({
        goal: 'Write debate output file',
        problem: `Failed to write ${description} to '${filePath}': ${err instanceof Error ? err.message : err}`,
        location: 'cli.writeOutput',
        nextSteps: [
          'Check available disk space',
          `Verify write permissions on '${outputDir}'`,
          `The debate completed successfully (ID: ${session.id}, ${session.transcript.length} entries) — re-run to regenerate output`,
        ],
        innerError: err,
      });
    }
  }

  // Write debate file
  const debateExt = outputFormat === 'markdown' ? 'md' : 'json';
  const debatePath = path.join(outputDir, `${slug}-debate.${debateExt}`);
  if (outputFormat === 'markdown') {
    writeOutput(debatePath, formatDebateMarkdown(session), 'debate markdown');
  } else {
    writeOutput(debatePath, JSON.stringify(session, null, 2), 'debate JSON');
  }

  // Always write JSON transcript too if format is markdown
  let transcriptPath = debatePath;
  if (outputFormat === 'markdown') {
    transcriptPath = path.join(outputDir, `${slug}-debate.json`);
    writeOutput(transcriptPath, JSON.stringify(session, null, 2), 'debate transcript JSON');
  }

  // Write diagnostics
  const diagPath = path.join(outputDir, `${slug}-diagnostics.json`);
  writeOutput(diagPath, JSON.stringify(buildDiagnosticsOutput(session), null, 2), 'diagnostics');

  // Write harvest
  const allNodeIds = new Set<string>();
  const nodeLabels = new Map<string, string>();
  for (const pov of POV_KEYS) {
    for (const n of taxonomy[pov].nodes) { allNodeIds.add(n.id); nodeLabels.set(n.id, n.label); }
  }
  for (const n of taxonomy.situations.nodes) { allNodeIds.add(n.id); nodeLabels.set(n.id, n.label); }
  const getNodeLabel = (id: string) => nodeLabels.get(id) ?? null;

  const harvestPath = path.join(outputDir, `${slug}-harvest.json`);
  writeOutput(harvestPath, JSON.stringify(buildHarvestOutput(session, getNodeLabel, allNodeIds), null, 2), 'harvest');

  // Also write markdown if format is json
  let markdownPath: string | undefined;
  if (outputFormat === 'json') {
    markdownPath = path.join(outputDir, `${slug}-debate.md`);
    writeOutput(markdownPath, formatDebateMarkdown(session), 'debate markdown');
  }

  // Log calibration data point (non-blocking)
  try {
    const { extractCalibrationData, appendCalibrationLog } = await import('./calibrationLogger.js');
    const dataRoot = path.dirname(outputDir); // outputDir is .../debates, data root is parent
    const dataPoint = extractCalibrationData(session, 'local');
    appendCalibrationLog(dataPoint, dataRoot);
    log(`Calibration data logged to ${dataRoot}/calibration/calibration-log.json`);
  } catch (err) {
    log(`Calibration logging failed (non-critical): ${err instanceof Error ? err.message : err}`);
  }

  const elapsed = Date.now() - startTime;

  // Output result JSON to stdout
  const result = {
    success: true,
    debateId: session.id,
    name: session.title,
    slug,
    topic: session.topic.final,
    files: {
      debate: debatePath,
      transcript: transcriptPath,
      diagnostics: diagPath,
      harvest: harvestPath,
      markdown: markdownPath ?? (outputFormat === 'markdown' ? debatePath : undefined),
    },
    stats: {
      rounds: engineConfig.rounds,
      entries: session.transcript.length,
      apiCalls: session.diagnostics?.overview.total_ai_calls ?? 0,
      totalTimeMs: elapsed,
      claimsAccepted: session.diagnostics?.overview.claims_accepted ?? 0,
      claimsRejected: session.diagnostics?.overview.claims_rejected ?? 0,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  log(`FATAL: ${msg}`);
  console.log(JSON.stringify({ success: false, error: msg }));
  process.exit(1);
});
