// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Inquiry job record store (t/3728). Durable record of every inquiry job while it is non-terminal.
// Enables cross-restart recovery: a GET whose in-memory job is gone (server restarted while the
// job was in-flight) falls back to the durable record (tier-3), serves an honest failed state,
// and self-reaps the record — so no accumulation sweep is needed.
//
// RETENTION POLICY (three mechanisms — no accumulation possible):
//  1. Delete-on-result-persist: deleteInquiryJobRecord is called immediately after saveInquiryResult
//     succeeds in inquiryJobs.ts. The durable InquiryResult is the source of truth for completed jobs.
//  2. Self-reap on tier-3 recovery: markJobFailedIfStale reads the record, returns the error
//     descriptor, then deletes the record. The caller (GET handler) serves the failed view from the
//     returned descriptor — no further record needed. Failed records from restarts do not accumulate.
//  3. Orphan reap: a non-terminal record whose heartbeat is older than INQUIRY_HEARTBEAT_STALE_MS
//     is treated as stale by markJobFailedIfStale (same staleness check as tier-3 gating). An
//     orphaned record (crash without clean shutdown) is reaped on the first GET after the threshold.
//
// NEW PERSISTED SHAPE (SO-mandatory — e/221#2): `inquiry-jobs/job-<jobId>.json` per-user.
// No index file — per-file layout is sufficient since recovery reads one record by jobId.
//
// Cross-user safety: all operations are user-scoped via getStorageUserId().

import path from 'path';
import { resolveDataPath } from '../config.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { log } from '../logger.js';
import { getStorageUserId, isAnonymousUser } from '../security/userContext.js';
import { getUserContentBackend, assertSafeId } from './fileIO.js';
import type { InquiryJobStatus } from '../../../../lib/inquiry/index.js';

// ── Staleness threshold (SO condition 8) ──
//
// Calibrated from the observed worst-case event-loop block on a real `deep` run: QBAF computation
// with 16 nodes produces a synchronous block measured at ~8 s (t/3728 calibration note).
// Threshold = 3× observed maximum = 3 × 8 s = 24 s, rounded to 30 s.
//
// This is 6× the heartbeat interval (5 s), so a healthy process emitting heartbeats every 5 s
// has 5 missed-heartbeat slots before the threshold fires. The threshold is orthogonal to the
// in-memory TTL sweep (which evicts terminal in-memory jobs after 30 min).
export const INQUIRY_HEARTBEAT_STALE_MS = 30_000;    // 30 s — 3× observed worst sync block
export const INQUIRY_HEARTBEAT_INTERVAL_MS = 5_000;  // 5 s — heartbeat write cadence

export interface InquiryJobRecord {
  jobId: string;
  userId: string;
  /** Process-generated UUID at module load — forensic only (SO e/221#2). Must NOT gate
   *  tier-3: misfires during deploy overlap where the old replica is still healthy. */
  bootId: string;
  status: InquiryJobStatus;
  /** ISO timestamp of the last heartbeat write; gating field for tier-3 and orphan reap. */
  lastHeartbeatAt: string;
  /** Durable result id (== jobId) once stored; null while in-flight. */
  resultId: string | null;
  /** Error descriptor (SO condition 6): code + bounded sanitized message — never raw free text.
   *  (Raw free text risks embedding user question text or prompt fragments.) */
  error: { code: string; message: string } | null;
  /** Dangle-tolerant debate reference. */
  debateId: string | null;
  /** Unix ms — job creation time. */
  startedAt: number;
}

function getJobsDir(userId?: string): string {
  const uid = userId ?? getStorageUserId();
  if (uid === '_local') return resolveDataPath('inquiry-jobs');
  return resolveDataPath(`users/${uid}/inquiry-jobs`);
}
function getJobFile(jobId: string): string {
  return path.join(getJobsDir(), `job-${jobId}.json`);
}

// ── Public API ──

/** Persist a job record (create or full overwrite). MUST be awaited for the initial creation write
 *  (SO condition 3 — a lost creation write silently makes the record non-existent for tier-3).
 *  Heartbeat and transition writes may be fire-and-forget. Anonymous: no-op. */
export async function saveInquiryJobRecord(record: InquiryJobRecord): Promise<void> {
  if (isAnonymousUser()) return;
  assertSafeId(record.jobId, 'inquiry job id');
  await getUserContentBackend().writeFile(getJobFile(record.jobId), JSON.stringify(record, null, 2));
}

/** Load a job record by jobId for the current user; null if absent, anonymous, or parse error. */
export async function loadInquiryJobRecord(jobId: string): Promise<InquiryJobRecord | null> {
  assertSafeId(jobId, 'inquiry job id');
  if (isAnonymousUser()) return null;
  const raw = await getUserContentBackend().readFile(getJobFile(jobId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as InquiryJobRecord;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'inquiry', level: 'warn',
      message: `Stored inquiry job record for ${jobId} is not valid JSON — treating as absent`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.warn({ err, jobId, cause: 'inquiry-job-record-unparseable' },
      'Stored inquiry job record is not valid JSON — treating as absent (t/3728)');
    return null;
  }
}

/** Delete a job record. Called on successful completion (mechanism 1) so the record does not
 *  outlive the result. Best-effort: a delete failure is logged but not thrown. */
export async function deleteInquiryJobRecord(jobId: string): Promise<void> {
  if (isAnonymousUser()) return;
  assertSafeId(jobId, 'inquiry job id');
  await getUserContentBackend().deleteFile(getJobFile(jobId)).catch((err) => {
    log.server.warn({ err, jobId }, 'inquiry-job-record delete failed (best-effort)');
  });
}

/** Tier-3 recovery + orphan reap. Reads the job record for `jobId` owned by the current user.
 *  Returns an error descriptor `{ code, message }` and self-reaps (deletes) the record if the
 *  heartbeat is stale. Returns null if:
 *  - record absent (never started durably, or already deleted / reaped),
 *  - record already terminal (tier 2 / result should have been found first),
 *  - heartbeat is still fresh (a live process owns this job).
 *
 *  Self-reap: deletes the record after capturing the error descriptor so stale records do not
 *  accumulate (retention mechanism 2). The delete is fire-and-forget; the caller responds with the
 *  failed view from the returned descriptor regardless of write outcome (SO condition 4). */
export async function markJobFailedIfStale(
  jobId: string,
): Promise<{ code: string; message: string } | null> {
  assertSafeId(jobId, 'inquiry job id');
  if (isAnonymousUser()) return null;

  const record = await loadInquiryJobRecord(jobId);
  if (!record) return null;

  // Already terminal — tier-2 should have found the result already; don't re-mark.
  if (record.status === 'done' || record.status === 'done_truncated' || record.status === 'failed') {
    return null;
  }

  const lastBeat = record.lastHeartbeatAt ? Date.parse(record.lastHeartbeatAt) : 0;
  if (Date.now() - lastBeat < INQUIRY_HEARTBEAT_STALE_MS) {
    // Fresh heartbeat — a live process owns this job. Don't fabricate a failure.
    return null;
  }

  // Stale heartbeat — the owning process is gone. Capture the error descriptor.
  const errorDescriptor = { code: 'restart', message: 'Server restarted while this inquiry was in progress.' };

  // Self-reap: delete the record so it doesn't accumulate (retention mechanism 2).
  // Fire-and-forget — the caller responds with the error view regardless.
  void deleteInquiryJobRecord(jobId).catch((err) => {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'inquiry', level: 'warn',
      message: `markJobFailedIfStale: record delete failed for ${jobId}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.warn({ err, jobId }, 'markJobFailedIfStale: record delete failed (responding anyway)');
  });

  return errorDescriptor;
}
