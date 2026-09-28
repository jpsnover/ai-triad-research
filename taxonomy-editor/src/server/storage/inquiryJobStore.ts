// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Inquiry job record store (t/3728). Durable record of every inquiry job while it is non-terminal.
// Enables cross-restart recovery: a GET whose in-memory job is gone (server restarted while the
// job was in-flight) falls back to the durable record (tier-3) and serves an honest failed state.
//
// RETENTION POLICY (e/221#2, e/221#7/8):
//  1. Delete-on-result-persist: deleteInquiryJobRecord is called after the `await saveInquiryResult()`
//     resolves in inquiryJobs.ts — the await ensures no window between result persist and record delete
//     (e/221#12: "immediately after" was ambiguous; "after the await resolves" is the safe reading).
//     The durable InquiryResult is the source of truth for completed jobs.
//  2. Compare-and-set on tier-3 recovery (e/221#8): markJobFailedIfStale writes status='failed'
//     (fire-and-forget) and returns the error descriptor. The 'failed' state is then DURABLE — a
//     user reload or second poll reads the same descriptor from the stored record. (Delete was
//     rejected: it makes the honest failed state at-most-once; if the single response doesn't land,
//     all subsequent polls see 404 instead of 'failed'. The ordinary reload-after-error case.)
//     Concurrent polls both write identical content — idempotent as a write, consistent as a read.
//  3. Orphan reap: a non-terminal record whose heartbeat is older than INQUIRY_HEARTBEAT_STALE_MS
//     is treated as stale by markJobFailedIfStale and promoted to 'failed' (same staleness check).
//     An orphaned record (crash without clean shutdown) is reaped on the first GET after threshold.
//
// RESIDUAL ACCUMULATION (stated, not denied — e/221#7/8):
//  All three mechanisms are poll- or completion-triggered; there is no background sweep (per-user
//  enumeration is infeasible — same problem that ruled out the boot-scan). Records accumulate for
//  jobs where the process crashed AND the user never polls again (closed tab, different device).
//  This is bounded by *abandoned* runs, not all runs or all failures — a small, event-driven set.
//  'failed' records from mechanism 2/3 also persist; no terminal TTL sweep exists today.
//  Future option (not yet built): a per-user registry file (cf. inquiryShareStore.shareRegistryPath)
//  would enable lazy enumeration within a user context at their next authenticated request — avoids
//  global enumeration and boot-scan. Don't build until volume warrants it.
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

// ── Staleness threshold (SO condition 8; e/221#6 framing correction) ──
//
// The operative invariant is a relationship, not a derived value:
//
//   STALE_MS ≥ WORST_SYNC_BLOCK_MS + N × INTERVAL_MS   (N ≥ 2)
//
// Why each term:
//   WORST_SYNC_BLOCK_MS — measured maximum synchronous QBAF block on a real `deep` run (16 nodes,
//     t/3728 calibration note). During a sync block the event loop is frozen, so the heartbeat
//     timer cannot fire and no poll can be served by the same process. The gap starts at the block,
//     not the interval.
//   N × INTERVAL_MS — heartbeat writes are fire-and-forget; a 429 burst from the storage backend
//     can drop more than one consecutive write. N ≥ 2 tolerates at least one dropped write and
//     one write whose latency adds a full interval to the effective cadence (the loop is
//     `await setTimeout(INTERVAL)` → await write, not a fixed-period setInterval).
//
// Current values: 8 + 2×5 = 18 s minimum; 30 s provides margin for additional drops.
// IF INQUIRY_HEARTBEAT_INTERVAL_MS is raised, STALE_MS must be rechecked against this invariant —
// the test in inquiryJobStoreInvariant.test.ts enforces it.
//
// Starvation-is-deploy-overlap-only (e/221#4): the event loop stalls heartbeats AND polls on the
// same process, so a false-failed requires a separate process serving the poll (the deploy-overlap
// window). This is why the threshold covers only the worst block, not a general liveness tolerance.
export const INQUIRY_HEARTBEAT_WORST_SYNC_BLOCK_MS = 8_000;  // measured max QBAF sync block (deep run)
export const INQUIRY_HEARTBEAT_INTERVAL_MS = 5_000;          // heartbeat write cadence
export const INQUIRY_HEARTBEAT_STALE_MS = 30_000;            // must satisfy: ≥ WORST_SYNC_BLOCK + 2×INTERVAL

// INQUIRY_ASSUMED_MAX_RUN_DURATION_MS — observed upper bound for a complete `deep` inquiry run.
// OBSERVED, NOT BOUNDED: `callBudget` bounds turn count, not wall time, so no hard cap exists.
// Named as a constant so both the retention-window floor and its invariant test reference the same
// assumption. If deep runs are observed to exceed this, raise it; the window must follow.
export const INQUIRY_ASSUMED_MAX_RUN_DURATION_MS = 60 * 60_000; // 1 h — generous, observed assumption

// ── Read-time retention window for terminal records (e/221#9, e/221#12) ──
//
// Terminal records (failed, done, done_truncated) are deleted on-read past this window.
// This bounds accumulation without enumeration or a background sweep:
//   - `failed` within window: second poll (user reload) returns the same error descriptor.
//   - `done`/`done_truncated` within window: tier-2 serves these first; if tier-2 misses
//     (orphaned by a dropped delete), the record itself has no result to return — 404 is best.
//   - Any terminal past window: deleted on-read, handler returns 404.
//
// POLICY CHOICE (not a derived relationship — e/221#10): the operative quantity is
// "how long after seeing an error might a user reload?" — a human-behaviour judgment with no
// measurable trace. 24 h is generous for any plausible reload.
//
// One floor IS statable: window > INQUIRY_ASSUMED_MAX_RUN_DURATION_MS — a run that dies near the
// end of its life must still get a non-zero reload window. Both operands are observed-not-bounded,
// stated separately so neither masquerades as measured. The invariant test in
// inquiryJobStoreInvariant.test.ts enforces this relationship.
//
// Window is measured from startedAt (not from the CAS transition) so total record lifetime is
// capped regardless of how long before discovery the job died (e/221#10 refinement 1).
export const INQUIRY_JOB_RECORD_FAILED_WINDOW_MS = 24 * 60 * 60_000; // 24 h policy — see comment above

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

/** Discriminated result from markJobFailedIfStale — three verdicts from tier-3 (e/221#11/12/13). */
export type InquiryTier3Result =
  | { verdict: 'failed'; error: { code: string; message: string } }
  | { verdict: 'live'; record: InquiryJobRecord }
  | null; // absent, terminal done/done_truncated within window, or past retention window → 404

/** Tier-3 recovery: determine the job's durable state from the persisted record (e/221#8/9/11/12).
 *
 *  Three verdicts:
 *  - `{ verdict: 'failed', error }` — stale heartbeat (CAS-write to `failed` fire-and-forget)
 *    OR already written `failed` within the retention window (durable second-poll descriptor).
 *  - `{ verdict: 'live', record }` — fresh heartbeat: a live process owns this job (possibly on
 *    another replica during deploy overlap). Serve the record's own status — honest "still running"
 *    rather than 404 (e/221#11: fresh heartbeat is positive evidence of liveness, not "unknown").
 *  - `null` — absent, terminal non-`failed` within window (tier-2 serves those), or past the
 *    retention window (deleted, caller returns 404).
 *
 *  Retention window applies to ALL terminal records (e/221#12): `done`/`done_truncated` orphaned
 *  by a dropped delete are also bounded. Window measures from startedAt (e/221#10).
 *  CAS semantics: two concurrent stale polls write identical content — idempotent (e/221#8).
 *  Response is independent of write outcome — SO condition 5. */
export async function markJobFailedIfStale(
  jobId: string,
): Promise<InquiryTier3Result> {
  assertSafeId(jobId, 'inquiry job id');
  if (isAnonymousUser()) return null;

  const record = await loadInquiryJobRecord(jobId);
  if (!record) return null;

  // Terminal records: apply retention window (e/221#12 — window covers any terminal, not just failed).
  if (record.status === 'failed' || record.status === 'done' || record.status === 'done_truncated') {
    if (Date.now() - record.startedAt > INQUIRY_JOB_RECORD_FAILED_WINDOW_MS) {
      void deleteInquiryJobRecord(jobId).catch((err) => {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'inquiry', level: 'warn',
          message: `markJobFailedIfStale: retention-window delete failed for ${jobId}`,
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        log.server.warn({ err, jobId }, 'markJobFailedIfStale: retention-window delete failed (404ing anyway)');
      });
      return null;
    }
    // Within window: failed records serve their descriptor; done/done_truncated return null
    // (tier-2 serves results first; if tier-2 missed, the record has no result to return → 404).
    if (record.status === 'failed' && record.error) return { verdict: 'failed', error: record.error };
    return null;
  }

  // Non-terminal: check heartbeat freshness.
  const lastBeat = record.lastHeartbeatAt ? Date.parse(record.lastHeartbeatAt) : 0;
  if (Date.now() - lastBeat < INQUIRY_HEARTBEAT_STALE_MS) {
    // Fresh heartbeat — a live process (possibly on another replica) owns this job (e/221#11).
    return { verdict: 'live', record };
  }

  // Stale heartbeat — the owning process is gone. CAS: write failed state (fire-and-forget).
  const errorDescriptor = { code: 'restart', message: 'Server restarted while this inquiry was in progress.' };
  void saveInquiryJobRecord({ ...record, status: 'failed', error: errorDescriptor }).catch((err) => {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'inquiry', level: 'warn',
      message: `markJobFailedIfStale: CAS write failed for ${jobId}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.server.warn({ err, jobId }, 'markJobFailedIfStale: CAS write failed (responding anyway)');
  });
  return { verdict: 'failed', error: errorDescriptor };
}
