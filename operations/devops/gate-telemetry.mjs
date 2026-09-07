// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared durable telemetry sink for DevOps run-gate predicates (t/3394 / t/3395).
 *
 * WHY: the Orca platform execution-telemetry writer died in the late-May update (confirmed Orca
 * Support t/3394#2) — `recent_executions`/`fire_count_24h` are unfed and run-gate script stdout/stderr
 * land nowhere queryable. So every blocking gate's fires/allows/fail-* events are invisible (the
 * t/3085 silently-dead-safety-net class). Each gate appends its own queryable JSONL record here to
 * restore an observable execution history; this module is the single shared append primitive so the
 * three blocking predicates don't each carry a divergent copy (TL e/147#5 — the class fix).
 *
 * ISOLATION INVARIANT (load-bearing): a gate calls appendGateTelemetry AFTER it has already computed
 * its verdict, and any failure here is swallowed (returns false, never throws) — so telemetry can
 * NEVER change a gate's block/allow/fail-closed decision. Best-effort by construction.
 */

/** Pure resolver: the `.gate-telemetry/` dir alongside the calling predicate module. */
export function gateTelemetryDir(moduleUrl) {
  return fileURLToPath(new URL('./.gate-telemetry/', moduleUrl));
}

/**
 * Append one JSON line to `<dir>/<fileName>`, creating the dir if needed. Returns true on success,
 * false on ANY failure (disk full, permission, bad path) — the caller must not depend on the result
 * and must never let it affect the gate verdict. `.gate-telemetry/` is gitignored (runtime data).
 */
export function appendGateTelemetry({ dir, fileName, record } = {}) {
  try {
    if (!dir || !fileName) return false;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, fileName), `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false; // best-effort — telemetry must never break the gate
  }
}
