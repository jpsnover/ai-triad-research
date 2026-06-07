// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface FlightEvent {
  type: string;
  component?: string;
  level?: string;
  message?: string;
  ts?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface LogSummary {
  path: string;
  eventCount: number;
  uniqueTypes: Set<string>;
  uniqueComponents: Set<string>;
  typeSequence: string[];
  componentCounts: Map<string, number>;
  typeCounts: Map<string, number>;
  errorTypes: string[];
  warningTypes: string[];
  pipelineStages: string[];
  debateId?: string;
  firstTs?: string;
  lastTs?: string;
}

const GUI_ONLY_COMPONENTS = new Set([
  'debate-workspace', 'diagnostics-panel', 'debate-store', 'state-guard',
  'debate-diagnostics', 'flightRecorderInit', 'ui', 'app',
]);

const GUI_ONLY_TYPES = new Set([
  'ui.navigate', 'ui.select', 'ui.toggle', 'user.action',
  'state.change', 'state.load', 'state.save', 'lifecycle',
]);

const NON_DETERMINISTIC_FIELDS = new Set([
  'ts', 'timestamp', 'latencyMs', 'promptTokens', 'completionTokens',
  'totalTokens', 'embedding', 'debate_id', 'id', 'claim_id', 'node_id',
]);

function parseLog(path: string): LogSummary {
  const raw = readFileSync(resolve(path), 'utf-8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const events: FlightEvent[] = lines.map(l => JSON.parse(l));

  const uniqueTypes = new Set<string>();
  const uniqueComponents = new Set<string>();
  const typeSequence: string[] = [];
  const componentCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const errorTypes: string[] = [];
  const warningTypes: string[] = [];
  const pipelineStages: string[] = [];
  let debateId: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;

  for (const ev of events) {
    const t = ev.type ?? 'unknown';
    const c = ev.component ?? 'unknown';

    uniqueTypes.add(t);
    uniqueComponents.add(c);
    typeSequence.push(t);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    componentCounts.set(c, (componentCounts.get(c) ?? 0) + 1);

    if (ev.level === 'error') errorTypes.push(t);
    if (ev.level === 'warn') warningTypes.push(t);
    if (t === 'turn.stage') pipelineStages.push(String(ev.data?.stage ?? ev.message ?? ''));
    if (!debateId && ev.debate_id) debateId = String(ev.debate_id);
    if (!firstTs && ev.ts) firstTs = String(ev.ts);
    if (ev.ts) lastTs = String(ev.ts);
  }

  return {
    path, eventCount: events.length, uniqueTypes, uniqueComponents,
    typeSequence, componentCounts, typeCounts, errorTypes, warningTypes,
    pipelineStages, debateId, firstTs, lastTs,
  };
}

function filterEngineEvents(summary: LogSummary): LogSummary {
  const filtered = { ...summary };
  filtered.uniqueTypes = new Set([...summary.uniqueTypes].filter(t => !GUI_ONLY_TYPES.has(t)));
  filtered.uniqueComponents = new Set([...summary.uniqueComponents].filter(c => !GUI_ONLY_COMPONENTS.has(c)));
  filtered.typeSequence = summary.typeSequence.filter(t => !GUI_ONLY_TYPES.has(t));
  return filtered;
}

function setDiff<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter(x => !b.has(x));
}

function compareStageSequences(cli: string[], gui: string[]): { match: boolean; divergences: string[] } {
  const cliUniq = [...new Set(cli)];
  const guiUniq = [...new Set(gui)];
  const divergences: string[] = [];

  const cliOnly = cliUniq.filter(s => !guiUniq.includes(s));
  const guiOnly = guiUniq.filter(s => !cliUniq.includes(s));

  if (cliOnly.length) divergences.push(`CLI-only stages: ${cliOnly.join(', ')}`);
  if (guiOnly.length) divergences.push(`GUI-only stages: ${guiOnly.join(', ')}`);

  if (cliUniq.length === guiUniq.length && cliUniq.every((s, i) => s === guiUniq[i])) {
    return { match: true, divergences };
  }

  divergences.push(`CLI stage order: ${cliUniq.join(' → ')}`);
  divergences.push(`GUI stage order: ${guiUniq.join(' → ')}`);
  return { match: divergences.length === 0, divergences };
}

function generateReport(cliPath: string, guiPath: string): string {
  const cliRaw = parseLog(cliPath);
  const guiRaw = parseLog(guiPath);

  const cli = filterEngineEvents(cliRaw);
  const gui = filterEngineEvents(guiRaw);

  const cliOnlyTypes = setDiff(cli.uniqueTypes, gui.uniqueTypes);
  const guiOnlyTypes = setDiff(gui.uniqueTypes, cli.uniqueTypes);
  const sharedTypes = [...cli.uniqueTypes].filter(t => gui.uniqueTypes.has(t));

  const cliOnlyComponents = setDiff(cli.uniqueComponents, gui.uniqueComponents);
  const guiOnlyComponents = setDiff(gui.uniqueComponents, cli.uniqueComponents);
  const sharedComponents = [...cli.uniqueComponents].filter(c => gui.uniqueComponents.has(c));

  const guiExcludedTypes = setDiff(guiRaw.uniqueTypes, gui.uniqueTypes);
  const guiExcludedComponents = setDiff(guiRaw.uniqueComponents, gui.uniqueComponents);

  const stageComparison = compareStageSequences(cli.pipelineStages, gui.pipelineStages);

  const moderatorTypes = ['debate.moderate', 'debate.phase', 'debate.round', 'debate.signal', 'debate.crux', 'debate.crux_transition'];
  const cliModEvents = moderatorTypes.filter(t => cli.uniqueTypes.has(t));
  const guiModEvents = moderatorTypes.filter(t => gui.uniqueTypes.has(t));
  const modMatch = cliModEvents.length === guiModEvents.length && cliModEvents.every(t => guiModEvents.includes(t));

  const anTypes = ['an.commit', 'an.extract', 'an.qbaf', 'an.commitment_update', 'an.extraction_confidence_missing'];
  const cliAnEvents = anTypes.filter(t => cli.uniqueTypes.has(t));
  const guiAnEvents = anTypes.filter(t => gui.uniqueTypes.has(t));
  const anMatch = cliAnEvents.length === guiAnEvents.length && cliAnEvents.every(t => guiAnEvents.includes(t));

  const divergences: string[] = [];
  if (cliOnlyTypes.length) divergences.push(`CLI-only event types: ${cliOnlyTypes.join(', ')}`);
  if (guiOnlyTypes.length) divergences.push(`GUI-only event types (after filtering UI): ${guiOnlyTypes.join(', ')}`);
  if (cliOnlyComponents.length) divergences.push(`CLI-only components: ${cliOnlyComponents.join(', ')}`);
  if (guiOnlyComponents.length) divergences.push(`GUI-only components (after filtering UI): ${guiOnlyComponents.join(', ')}`);
  if (!stageComparison.match) divergences.push(...stageComparison.divergences);
  if (!modMatch) divergences.push(`Moderator divergence — CLI: [${cliModEvents.join(', ')}] vs GUI: [${guiModEvents.join(', ')}]`);
  if (!anMatch) divergences.push(`Argument network divergence — CLI: [${cliAnEvents.join(', ')}] vs GUI: [${guiAnEvents.join(', ')}]`);

  const verdict = divergences.length === 0 ? 'EQUIVALENT' : 'DIVERGENT';

  const lines: string[] = [];
  lines.push('CLI vs GUI Debate Parity Report');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`CLI log:  ${cliPath}`);
  lines.push(`GUI log:  ${guiPath}`);
  lines.push(`CLI debate ID: ${cliRaw.debateId ?? 'unknown'}`);
  lines.push(`GUI debate ID: ${guiRaw.debateId ?? 'unknown'}`);
  lines.push('');

  lines.push('── Raw Event Counts ──');
  lines.push(`  CLI: ${cliRaw.eventCount} events | GUI: ${guiRaw.eventCount} events`);
  lines.push(`  GUI-only types filtered: ${guiExcludedTypes.join(', ') || 'none'}`);
  lines.push(`  GUI-only components filtered: ${guiExcludedComponents.join(', ') || 'none'}`);
  lines.push('');

  lines.push('── Event Types (engine-only) ──');
  lines.push(`  CLI: ${cli.uniqueTypes.size} unique | GUI: ${gui.uniqueTypes.size} unique | Shared: ${sharedTypes.length}`);
  if (cliOnlyTypes.length) lines.push(`  CLI-only: ${cliOnlyTypes.join(', ')}`);
  if (guiOnlyTypes.length) lines.push(`  GUI-only: ${guiOnlyTypes.join(', ')}`);
  lines.push('');

  lines.push('── Components (engine-only) ──');
  lines.push(`  CLI: ${cli.uniqueComponents.size} | GUI: ${gui.uniqueComponents.size} | Shared: ${sharedComponents.length}`);
  if (cliOnlyComponents.length) lines.push(`  CLI-only: ${cliOnlyComponents.join(', ')}`);
  if (guiOnlyComponents.length) lines.push(`  GUI-only: ${guiOnlyComponents.join(', ')}`);
  lines.push('');

  lines.push('── Pipeline Stages ──');
  lines.push(`  CLI stages: ${[...new Set(cli.pipelineStages)].join(' → ') || 'none recorded'}`);
  lines.push(`  GUI stages: ${[...new Set(gui.pipelineStages)].join(' → ') || 'none recorded'}`);
  lines.push(`  Match: ${stageComparison.match ? 'YES' : 'NO'}`);
  lines.push('');

  lines.push('── Moderator Events ──');
  lines.push(`  CLI: [${cliModEvents.join(', ')}]`);
  lines.push(`  GUI: [${guiModEvents.join(', ')}]`);
  lines.push(`  Match: ${modMatch ? 'YES' : 'NO'}`);
  lines.push('');

  lines.push('── Argument Network ──');
  lines.push(`  CLI: [${cliAnEvents.join(', ')}]`);
  lines.push(`  GUI: [${guiAnEvents.join(', ')}]`);
  lines.push(`  Match: ${anMatch ? 'YES' : 'NO'}`);
  lines.push('');

  lines.push('── Errors / Warnings ──');
  lines.push(`  CLI errors: ${cliRaw.errorTypes.length} | GUI errors: ${guiRaw.errorTypes.length}`);
  lines.push(`  CLI warnings: ${cliRaw.warningTypes.length} | GUI warnings: ${guiRaw.warningTypes.length}`);
  lines.push('');

  lines.push('── Type Counts Comparison ──');
  const allTypes = new Set([...cli.uniqueTypes, ...gui.uniqueTypes]);
  for (const t of [...allTypes].sort()) {
    const cliCount = cliRaw.typeCounts.get(t) ?? 0;
    const guiCount = guiRaw.typeCounts.get(t) ?? 0;
    const marker = cliCount === 0 ? ' [GUI-only]' : guiCount === 0 ? ' [CLI-only]' : '';
    lines.push(`  ${t.padEnd(40)} CLI: ${String(cliCount).padStart(4)}  GUI: ${String(guiCount).padStart(4)}${marker}`);
  }
  lines.push('');

  lines.push('═'.repeat(50));
  lines.push(`VERDICT: ${verdict}`);
  if (divergences.length) {
    lines.push('');
    lines.push('Divergences:');
    for (const d of divergences) lines.push(`  • ${d}`);
  }

  return lines.join('\n');
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: tsx scripts/compare-flight-logs.ts <cli-log.jsonl> <gui-log.jsonl>');
  process.exit(1);
}

const report = generateReport(args[0], args[1]);
console.log(report);
