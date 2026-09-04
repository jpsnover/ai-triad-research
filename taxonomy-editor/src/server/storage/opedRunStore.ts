// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Op-ed run-control persistence — blob-backed shared store for SSE run records.
 *
 * Replaces the per-process `Map<string, OpEdRun>` in routes/oped.ts so that
 * run state survives across replicas (maxReplicas>1). Re-exported from fileIO.ts.
 *
 * Design: authed-only (anonymous path unreachable in hosted mode — double-gated
 * by allowlist + explicit isAnonymousUser()→403 in oped.ts). Guard retained here
 * for defence-in-depth.
 *
 * Lazy TTL expiry: countRunningOpedRuns deletes stale 'running' blobs (crashed-A
 * protection) best-effort/fire-and-forget so the count cap is self-healing.
 */

import path from 'path';
import { resolveDataPath } from '../config.js';
import { getUserContentBackend, assertSafeId } from './fileIO.js';
import { isAnonymousUser, getStorageUserId } from '../security/userContext.js';
import { log } from '../logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'complete' | 'cancelled' | 'error';
export type VoiceState = 'pending' | 'complete' | 'failed' | 'cancelled';

export interface RunControlRecord {
  runId: string;
  userId: string;
  setId: string;
  status: RunStatus;
  perVoice: Record<string, VoiceState>;
  startedAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Hard ceiling for a stuck 'running' blob — lazy-expire after this TTL. */
const RUNNING_STALE_TTL_MS = 15 * 60_000; // 15 min

// ── Dir helper ─────────────────────────────────────────────────────────────────

function getOpedRunsDir(userId: string): string {
  if (userId === '_local') return resolveDataPath('oped-runs');
  return resolveDataPath(`users/${userId}/oped-runs`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Write or overwrite the run-control blob for this run.
 * No-op for anonymous users (guard for defence-in-depth; callers are authed-only).
 */
export async function upsertOpedRun(record: RunControlRecord): Promise<void> {
  if (isAnonymousUser()) return;
  assertSafeId(record.runId, 'oped-run id');
  const backend = getUserContentBackend();
  const filePath = path.join(getOpedRunsDir(record.userId), `oped-run-${record.runId}.json`);
  await backend.writeFile(filePath, JSON.stringify(record, null, 2));
}

/**
 * Count running op-ed runs for userId.
 * Lazy-expires stale 'running' blobs (crashed-A protection) — best-effort delete,
 * stale blobs are not counted toward the cap.
 * Returns 0 for anonymous users.
 */
export async function countRunningOpedRuns(userId: string): Promise<number> {
  if (isAnonymousUser()) return 0;
  const backend = getUserContentBackend();
  const dir = getOpedRunsDir(userId);
  const files = await backend.listDirectory(dir);
  if (files.length === 0) return 0;

  const runFiles = files.filter(f => f.startsWith('oped-run-') && f.endsWith('.json'));
  let count = 0;

  for (const file of runFiles) {
    const raw = await backend.readFile(path.join(dir, file));
    if (raw === null) continue;
    let record: RunControlRecord;
    try {
      record = JSON.parse(raw) as RunControlRecord;
    } catch {
      /* telemetry — silent by design */
      continue;
    }

    if (record.status !== 'running') continue;

    const isStale = Date.now() - record.startedAt > RUNNING_STALE_TTL_MS;
    if (isStale) {
      // Lazy delete — best-effort fire-and-forget; stale blob is NOT counted
      backend.deleteFile(path.join(dir, file)).catch(() => { /* telemetry — silent by design */ });
      log.server.warn({ runId: record.runId, startedAt: record.startedAt },
        'countRunningOpedRuns: lazy-expired stale running blob (crashed-A protection)');
    } else {
      count += 1;
    }
  }

  return count;
}

/**
 * Load run-control record by runId.
 * Returns null if not found or if user context is unavailable.
 */
export async function getOpedRun(runId: string): Promise<RunControlRecord | null> {
  assertSafeId(runId, 'oped-run id');
  const userId = getStorageUserId();
  if (!userId) return null;
  const backend = getUserContentBackend();
  const raw = await backend.readFile(path.join(getOpedRunsDir(userId), `oped-run-${runId}.json`));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as RunControlRecord;
  } catch {
    /* telemetry — silent by design */
    return null;
  }
}
