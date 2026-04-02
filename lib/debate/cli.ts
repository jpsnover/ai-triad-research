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
import { createCLIAdapter } from './aiAdapter';
import { resolveRepoRoot, loadTaxonomy, loadSourceContent, fetchUrlContent, loadConflicts } from './taxonomyLoader';
import { DebateEngine } from './debateEngine';
import type { DebateConfig } from './debateEngine';
import type { DebateSourceType, PoverId } from './types';
import { POVER_INFO } from './types';
import { formatSituationDebateContext } from './prompts';
import { generateSlug, formatDebateMarkdown, buildDiagnosticsOutput, buildHarvestOutput } from './formatters';

// ── CLI Config schema ────────────────────────────────────

interface CLIConfig {
  topic?: string;
  name?: string;
  docPath?: string;
  url?: string;
  situationId?: string;
  activePovers?: string[];
  model?: string;
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
}

// ── Main ─────────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[debate-cli] ${msg}\n`);
}

function parseArgs(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--config');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];

  // Try stdin
  if (args.includes('--stdin')) return '-';

  console.error('Usage: npx tsx lib/debate/cli.ts --config <path.json>');
  process.exit(1);
}

async function main(): Promise<void> {
  const configPath = parseArgs();
  let configText: string;

  if (configPath === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    configText = Buffer.concat(chunks).toString('utf-8');
  } else {
    const resolvedConfig = path.resolve(configPath);
    if (!fs.existsSync(resolvedConfig)) {
      throw new Error(`Config file not found: ${resolvedConfig}\nProvide a valid JSON config file via --config <path>.`);
    }
    try {
      configText = fs.readFileSync(resolvedConfig, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read config file ${resolvedConfig}: ${err instanceof Error ? err.message : err}`);
    }
  }

  let config: CLIConfig;
  try {
    config = JSON.parse(configText);
  } catch (err) {
    throw new Error(
      `Config file contains invalid JSON: ${err instanceof Error ? err.message : err}\n` +
      `First 200 chars: ${configText.slice(0, 200)}`
    );
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

  // Resolve topic source
  let topic = config.topic ?? '';
  let sourceType: DebateSourceType = 'topic';
  let sourceRef = '';
  let sourceContent = '';

  if (config.docPath) {
    sourceType = 'document';
    sourceRef = config.docPath;
    sourceContent = loadSourceContent(config.docPath);
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
    if (!sitNode) throw new Error(`Situation node not found: ${config.situationId}`);

    // Build situation context
    const conflicts = loadConflicts(repoRoot);
    const conflictSummaries = conflicts
      .filter(c => c.linked_taxonomy_nodes.includes(config.situationId!))
      .map(c => `${c.claim_label}: ${c.description}`)
      .slice(0, 5);

    const linkedNodeDescriptions: string[] = [];
    for (const linkedId of sitNode.linked_nodes.slice(0, 10)) {
      for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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

  if (!topic) throw new Error('No topic specified. Provide --topic, --docPath, --url, or --situationId');

  // Validate debaters
  const activePovers = (config.activePovers ?? ['prometheus', 'sentinel', 'cassandra']) as Exclude<PoverId, 'user'>[];
  if (activePovers.length < 2) throw new Error('At least 2 debaters required');
  for (const p of activePovers) {
    if (!POVER_INFO[p]) throw new Error(`Unknown debater: ${p}. Valid: prometheus, sentinel, cassandra`);
  }

  // Create adapter
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
    rounds: config.rounds ?? 3,
    responseLength: (config.responseLength ?? 'medium') as 'brief' | 'medium' | 'detailed',
    enableClarification: config.enableClarification,
    enableProbing: config.enableProbing,
    probingInterval: config.probingInterval ?? 2,
    temperature: config.temperature,
  };

  // Run debate
  log(`Starting debate: "${topic.slice(0, 80)}..." with ${activePovers.join(', ')}, ${engineConfig.rounds} rounds`);
  const engine = new DebateEngine(engineConfig, adapter, taxonomy);
  const session = await engine.run((p) => {
    log(`[${p.phase}] ${p.speaker ? `${p.speaker}: ` : ''}${p.message}`);
  });

  // Generate outputs
  const slug = config.slug ?? generateSlug(config.name ?? topic);
  const outputDir = path.resolve(config.outputDir ?? './debates');
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to create output directory '${outputDir}': ${err instanceof Error ? err.message : err}\n` +
      `Check that the parent directory exists and you have write permissions.`
    );
  }

  const outputFormat = config.outputFormat ?? 'json';

  function writeOutput(filePath: string, content: string, description: string): void {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      log(`Wrote ${description}: ${filePath}`);
    } catch (err) {
      throw new Error(
        `Failed to write ${description} to '${filePath}': ${err instanceof Error ? err.message : err}\n` +
        `The debate completed successfully but output could not be saved. Check disk space and permissions.\n` +
        `Debate ID: ${session.id} (${session.transcript.length} entries)`
      );
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
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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
