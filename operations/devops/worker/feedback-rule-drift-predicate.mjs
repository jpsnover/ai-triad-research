// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendGateTelemetry, gateTelemetryDir } from '../gate-telemetry.mjs';

/**
 * Observability detector for silently-discarded feedback rules (t/3699, observability
 * counterpart to t/3698/t/2379). NOT a gate — this never blocks anything.
 *
 * FAILURE CLASS it makes diagnosable: an `.orca/feedback-rules/*.yaml` definition can be
 * REJECTED at load time (bad `source:` prefix, schema mismatch) while the file sits on disk
 * looking live. `list_feedback_rules` reports only what actually loaded, so a definition
 * present on disk but ABSENT from that list is exactly the t/3698 root-cause signature — 14
 * rules sat dead fleet-wide for ~3 weeks with no signal. This function is the pure diff; the
 * impure halves (reading the yaml directory, calling the `list_feedback_rules` MCP tool) are
 * the scheduled harness's job, mirroring the pure-core/impure-shim split in
 * `operations/devops/merge-guard-predicate.mjs`.
 *
 * Deliberately NOT implemented as a feedback rule (SO constraint, t/3699): a rule that detects
 * silently-discarded rules would itself be silently discardable, and its silence would read as
 * "nothing to report" — indistinguishable from the failure it exists to catch.
 */
export function diffFeedbackRules(onDiskNames, loadedNames) {
  const onDisk = Array.isArray(onDiskNames) ? onDiskNames : [];
  const loaded = new Set(Array.isArray(loadedNames) ? loadedNames : []);
  return { discarded: onDisk.filter((name) => !loaded.has(name)) };
}

/** Pure: `.orca/feedback-rules/*.yaml` file basenames (no extension) under repoRoot. */
export function listOnDiskRuleNames(repoRoot) {
  const dir = path.join(repoRoot, '.orca', 'feedback-rules');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return []; // dir absent/unreadable — caller treats an empty on-disk set as "nothing to diff"
  }
  return entries.filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -'.yaml'.length)).sort();
}

/** Pure builder for the durable execution record (t/2070 telemetry-sink principle). */
export function buildDriftCheckSinkRecord({ nowIso, onDiskCount, loadedCount, discarded } = {}) {
  return {
    ts: nowIso ?? null,
    check: 'feedback-rule-drift',
    onDiskCount: onDiskCount ?? null,
    loadedCount: loadedCount ?? null,
    discarded: Array.isArray(discarded) ? discarded : [],
  };
}

// CLI shim (t/3699): the scheduled harness invokes THIS module directly so the run uses the
// exact logic the both-arms test proves — test == runtime (same discipline as
// merge-guard-predicate.mjs). The harness has already called `list_feedback_rules` (impure,
// MCP-only, cannot happen inside this script) and passes the loaded names as a JSON array arg;
// on-disk names are read here directly from the filesystem (overlay-tracked, plain fs access).
//
// Usage: node feedback-rule-drift-predicate.mjs '<jsonArrayOfLoadedNames>' [repoRoot]
// Always appends a durable JSONL record (runs whether clean or not — the execution record is
// the point, per t/2070: this check must be provably running, unlike the rules it audits).
// Exit 0 + no stdout when clean; exit 1 + prints the discarded names (one per line) when not.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('feedback-rule-drift-predicate.mjs')) {
  const loadedNames = JSON.parse(process.argv[2] || '[]');
  const repoRoot = process.argv[3] || fileURLToPath(new URL('../../../', import.meta.url));
  const onDiskNames = listOnDiskRuleNames(repoRoot);
  const { discarded } = diffFeedbackRules(onDiskNames, loadedNames);

  appendGateTelemetry({
    dir: gateTelemetryDir(import.meta.url),
    fileName: 'feedback-rule-drift.jsonl',
    record: buildDriftCheckSinkRecord({
      nowIso: new Date().toISOString(),
      onDiskCount: onDiskNames.length,
      loadedCount: loadedNames.length,
      discarded,
    }),
  });

  if (discarded.length > 0) {
    process.stdout.write(discarded.join('\n') + '\n');
    process.exitCode = 1;
  }
}
