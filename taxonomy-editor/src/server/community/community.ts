// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import crypto from 'crypto';
import { resolveDataPath } from '../config.js';
import { getUserContentBackend, assertSafeId } from '../storage/fileIO.js';
import { sanitizeUserText } from '../security/contentSanitizer.js';
import { getStorageUserId, isAnonymousUser } from '../security/userContext.js';
import { log } from '../logger.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import path from 'path';
import { getConfig } from '../runtimeConfig.js';

// ── Paths ──

function communityChatsDir(): string { return resolveDataPath('community/chats'); }
function communityDebatesDir(): string { return resolveDataPath('community/debates'); }
function submissionsDir(): string { return resolveDataPath('community/_submissions'); }
function removalsDir(): string { return resolveDataPath('community/_removals'); }

// ── Admin ──

function getAdminUsers(): string[] {
  return (process.env.ADMIN_USERS || 'jpsnover').split(',').map(s => s.trim());
}

export function isAdmin(userId?: string): boolean {
  const uid = userId ?? getStorageUserId();
  return uid !== '_local' && getAdminUsers().includes(uid);
}

// ── Listing index (t/726) ──
//
// Community chats/debates are append-only shared data on `main`. Listing them by
// reading every file (1 listDirectory + N readFile) cost ~51 GitHub API calls /
// 10-15s for 50 items on a cold cache. Instead each directory keeps a sibling
// `_index.json` holding the lean metadata each listing returns; reads serve from
// it (1 read) and a count-based staleness check — listDirectory() uses the
// in-memory repoTree, so it costs 0 API calls — triggers a rebuild when the file
// count drifts. The index is a cache only: a missing/stale index always falls
// back to a full scan, so it can never serve data the directory doesn't have.
//
// This mirrors listDebateSessionsMeta() in fileIO.ts. Submissions are
// intentionally NOT indexed here: their records are mutable (status flips on
// approve/reject) under a split-ref write model (submit → main, approve/reject →
// session branch), so a count-based index would serve stale statuses. They keep
// per-file reads until the write flow is unified or moved to blob storage (t/695).

const COMMUNITY_INDEX_FILE = '_index.json';

interface ListingIndexSpec<T> {
  dir: string;
  prefix: string;
  toEntry: (parsed: any) => T;
  malformedMessage: string;
}

/** Direct-child item files in `dir` matching `prefix` (excludes `_index.json`). */
async function listIndexedFiles(dir: string, prefix: string): Promise<string[]> {
  const backend = getUserContentBackend();
  return (await backend.listDirectory(dir))
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'));
}

/** Full scan: read every item file, build the lean index, persist it (best-effort). */
async function rebuildListingIndex<T>(spec: ListingIndexSpec<T>): Promise<T[]> {
  const backend = getUserContentBackend();
  const files = await listIndexedFiles(spec.dir, spec.prefix);
  const entries: T[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(spec.dir, f));
      if (raw === null) continue;
      entries.push(spec.toEntry(JSON.parse(raw)));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'community',
        level: 'warn',
        message: spec.malformedMessage,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      /* skip malformed */
    }
  }
  // Best-effort: a read-only context (or exhausted API) just keeps full-scanning.
  await backend.writeFile(
    path.join(spec.dir, COMMUNITY_INDEX_FILE),
    JSON.stringify(entries, null, 2),
  ).catch((err) => { log.server.warn({ err }, 'Community listing index write failed (best-effort)'); });
  return entries;
}

/**
 * Serve a community listing from its `_index.json`, rebuilding when the index is
 * absent (cold start) or its entry count no longer matches the directory. When a
 * stale index exists, the cached copy is returned immediately and the rebuild
 * runs in the background. Returns entries unsorted — callers apply their own sort.
 */
async function listViaIndex<T>(spec: ListingIndexSpec<T>): Promise<T[]> {
  const backend = getUserContentBackend();
  let cached: T[] | null = null;
  try {
    const raw = await backend.readFile(path.join(spec.dir, COMMUNITY_INDEX_FILE));
    if (raw !== null) cached = JSON.parse(raw) as T[];
  } catch { /* telemetry — silent by design */ cached = null; }

  if (cached !== null) {
    try {
      const files = await listIndexedFiles(spec.dir, spec.prefix);
      if (files.length === cached.length) return cached;
      // Count drift — refresh in the background, serve the cached copy now for speed.
      void rebuildListingIndex(spec).catch((err) => { log.server.warn({ err }, 'Background community index rebuild failed'); });
      return cached;
    } catch {
      /* telemetry — silent by design */
      return cached; // tree unavailable — trust the index
    }
  }
  return rebuildListingIndex(spec);
}

// ── Community read ──

interface CommunityChatEntry {
  id: unknown; title: string; created_at: string; updated_at: string;
  mode: string; community_metadata: unknown;
}

interface CommunityDebateEntry {
  id: unknown; title: string; created_at: string; updated_at: string;
  phase: string; community_metadata: unknown;
}

export async function listCommunityChats(): Promise<unknown[]> {
  const items = await listViaIndex<CommunityChatEntry>({
    dir: communityChatsDir(),
    prefix: 'chat-',
    malformedMessage: 'Skipping malformed community chat file',
    toEntry: (parsed) => ({
      id: parsed.id,
      title: parsed.title || 'Untitled',
      created_at: parsed.created_at || '',
      updated_at: parsed.updated_at || parsed.created_at || '',
      mode: parsed.mode || '',
      community_metadata: stripOriginalId(parsed.community_metadata || null), // t/856
    }),
  });
  return [...items].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function listCommunityDebates(): Promise<unknown[]> {
  const items = await listViaIndex<CommunityDebateEntry>({
    dir: communityDebatesDir(),
    prefix: 'debate-',
    malformedMessage: 'Skipping malformed community debate file',
    toEntry: (parsed) => ({
      id: parsed.id,
      title: parsed.title || parsed.topic?.final || parsed.topic?.original || 'Untitled Debate',
      created_at: parsed.created_at || '',
      updated_at: parsed.updated_at || parsed.created_at || '',
      phase: parsed.phase || 'unknown',
      community_metadata: stripOriginalId(parsed.community_metadata || null), // t/856
    }),
  });
  return [...items].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function loadCommunityItem(type: 'chats' | 'debates', id: string): Promise<unknown | null> {
  assertSafeId(id, 'community id'); // block path traversal (M2)
  const backend = getUserContentBackend();
  const dir = type === 'chats' ? communityChatsDir() : communityDebatesDir();
  const prefix = type === 'chats' ? 'chat-' : 'debate-';
  const raw = await backend.readFile(path.join(dir, `${prefix}${id}.json`));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // t/856: don't expose the pre-share private UUID in public responses.
  if (parsed.community_metadata) parsed.community_metadata = stripOriginalId(parsed.community_metadata);
  return parsed;
}

// ── Submissions ──

interface Submission {
  id: string;
  type: 'chat' | 'debate';
  originalId: string;
  submittedBy: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  rejectionReason?: string;
  data: unknown;
}

export async function submitToCommunity(type: 'chat' | 'debate', itemData: unknown, note?: string): Promise<{ submissionId: string }> {
  const userId = getStorageUserId();
  const backend = getUserContentBackend();
  const dir = submissionsDir();

  // Rate limit: max pending submissions per user (t/929: runtime-configurable, default 20)
  const maxPendingPerUser = getConfig().community.maxPendingPerUser;
  const existing = await listSubmissionsForUser(userId);
  const pending = existing.filter(s => s.status === 'pending');
  if (pending.length >= maxPendingPerUser) {
    throw Object.assign(new Error(`Maximum ${maxPendingPerUser} pending submissions allowed`), { statusCode: 429 });
  }

  // L7 (t/720): global pending-queue cap — backstop against many users (or
  // anonymous sessions) collectively exhausting the review queue / storage.
  const GLOBAL_PENDING_CAP = getConfig().community.globalPendingCap; // t/929: runtime-configurable (default 500)
  const allPending = await listSubmissions('pending');
  if (allPending.length >= GLOBAL_PENDING_CAP) {
    throw Object.assign(new Error('Community submission queue is full; please try again later.'), { statusCode: 503 });
  }

  const item = itemData as { id: string };
  const submissionId = crypto.randomUUID();
  const submission: Submission = {
    id: submissionId,
    type,
    originalId: item.id,
    submittedBy: userId,
    submittedAt: new Date().toISOString(),
    status: 'pending',
    note,
    data: itemData,
  };

  // t/700: community submissions live in Azure Blob (no git branches), so the
  // ref:'main' overlay-bypass that was needed on the GitHub backend (t/694) is gone.
  await backend.writeFile(
    path.join(dir, `sub-${submissionId}.json`),
    JSON.stringify(submission, null, 2),
  );

  log.server.info({ submissionId, type, userId }, 'Community submission created');

  // Admin submissions are auto-approved — skip the pending queue.
  if (isAdmin(userId)) {
    await approveSubmission(submissionId);
    log.server.info({ submissionId, type, userId }, 'Admin submission auto-approved');
  }

  return { submissionId };
}

async function listSubmissionsForUser(userId: string): Promise<Submission[]> {
  const backend = getUserContentBackend();
  const dir = submissionsDir();
  const files = (await backend.listDirectory(dir)).filter(f => f.startsWith('sub-') && f.endsWith('.json'));
  const subs: Submission[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f));
      if (raw === null) continue;
      const s = JSON.parse(raw) as Submission;
      if (s.submittedBy === userId) subs.push(s);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'community',
        level: 'warn',
        message: 'Skipping malformed submission file (user list)',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      /* skip */
    }
  }
  return subs;
}

export async function listSubmissions(statusFilter?: string): Promise<unknown[]> {
  const backend = getUserContentBackend();
  const dir = submissionsDir();
  const files = (await backend.listDirectory(dir)).filter(f => f.startsWith('sub-') && f.endsWith('.json'));
  const subs: Submission[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f));
      if (raw === null) continue;
      const s = JSON.parse(raw) as Submission;
      if (!statusFilter || s.status === statusFilter) subs.push(s);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'community',
        level: 'warn',
        message: 'Skipping malformed submission file (admin list)',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      /* skip */
    }
  }
  return subs.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

const SENSITIVE_KEYS = new Set([
  'api_key', 'apiKey', 'api_keys', 'apiKeys',
  'secret', 'token', 'password', 'credential', 'credentials',
  'authorization', 'auth_token', 'access_token', 'refresh_token',
  'private_key', 'privateKey',
  'flight_recorder', 'debug', '_internal', 'diagnostics_state',
]);

function stripSensitiveKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripSensitiveKeys);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      if (/^(sk-|AIza|gsk_|key-|xai-|Bearer\s)/.test(value)) continue;
      result[key] = sanitizeUserText(value); // t/856: neutralize executable tags / schemes server-side
      continue;
    }
    result[key] = stripSensitiveKeys(value);
  }
  return result;
}

/** t/856: drop the pre-share private UUID from community_metadata before it's
 *  served publicly (kept in the stored file for admin tracing). */
function stripOriginalId(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object') return meta;
  const rest = { ...(meta as Record<string, unknown>) };
  delete rest.original_id;
  return rest;
}

function sanitizeForCommunity(data: unknown, submittedBy: string): unknown {
  const d = stripSensitiveKeys(JSON.parse(JSON.stringify(data))) as Record<string, unknown>;
  d.community_metadata = {
    submitted_by_display: submittedBy,
    submitted_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    original_id: d.id,
  };
  d.id = crypto.randomUUID();
  return d;
}

export async function approveSubmission(
  submissionId: string,
  edits?: Record<string, unknown>,
): Promise<{ communityId: string }> {
  assertSafeId(submissionId, 'submission id'); // t/850: defense-in-depth parity with sibling fns
  const backend = getUserContentBackend();
  const subPath = path.join(submissionsDir(), `sub-${submissionId}.json`);
  const raw = await backend.readFile(subPath);
  if (!raw) throw Object.assign(new Error('Submission not found'), { statusCode: 404 });

  const submission = JSON.parse(raw) as Submission;
  if (submission.status !== 'pending') throw Object.assign(new Error(`Submission already ${submission.status}`), { statusCode: 409 });

  // Edit-on-promote (t/650 AC#4): shallow-merge admin edits (e.g. title /
  // description) onto the data before sanitizing + publishing. The user's stored
  // submission is left as-is — edits affect only the published copy.
  const dataToPublish = (edits && typeof edits === 'object' && submission.data && typeof submission.data === 'object')
    ? { ...(submission.data as Record<string, unknown>), ...edits }
    : submission.data;
  const sanitized = sanitizeForCommunity(dataToPublish, submission.submittedBy) as { id: string };
  const dir = submission.type === 'chat' ? communityChatsDir() : communityDebatesDir();
  const prefix = submission.type === 'chat' ? 'chat-' : 'debate-';

  await backend.writeFile(
    path.join(dir, `${prefix}${sanitized.id}.json`),
    JSON.stringify(sanitized, null, 2),
  );

  // Update submission status
  submission.status = 'approved';
  await backend.writeFile(subPath, JSON.stringify(submission, null, 2));

  log.server.info({ submissionId, communityId: sanitized.id, type: submission.type }, 'Community submission approved');
  return { communityId: sanitized.id };
}

export async function rejectSubmission(submissionId: string, reason?: string): Promise<void> {
  assertSafeId(submissionId, 'submission id'); // t/850: defense-in-depth parity with sibling fns
  const backend = getUserContentBackend();
  const subPath = path.join(submissionsDir(), `sub-${submissionId}.json`);
  const raw = await backend.readFile(subPath);
  if (!raw) throw Object.assign(new Error('Submission not found'), { statusCode: 404 });

  const submission = JSON.parse(raw) as Submission;
  if (submission.status !== 'pending') throw Object.assign(new Error(`Submission already ${submission.status}`), { statusCode: 409 });

  submission.status = 'rejected';
  // Persist the admin's reason so it can surface in a "My Submissions" view (t/650 AC#6).
  if (reason) submission.rejectionReason = reason;
  await backend.writeFile(subPath, JSON.stringify(submission, null, 2));

  log.server.info({ submissionId, type: submission.type }, 'Community submission rejected');
}

export async function copyFromCommunity(type: 'chats' | 'debates', communityId: string): Promise<{ newId: string }> {
  if (isAnonymousUser()) throw Object.assign(new Error('Anonymous users cannot copy community items'), { statusCode: 403 });

  const item = await loadCommunityItem(type, communityId);
  if (!item) throw Object.assign(new Error('Community item not found'), { statusCode: 404 });

  const copy = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
  copy.id = crypto.randomUUID();
  copy.copied_from_community = communityId;
  copy.created_at = new Date().toISOString();
  copy.updated_at = new Date().toISOString();

  // Import into user's personal store via fileIO (which routes to user dir)
  const { saveChatSession, saveDebateSession } = await import('../storage/fileIO.js');
  if (type === 'chats') {
    await saveChatSession(copy);
  } else {
    await saveDebateSession(copy);
  }

  return { newId: copy.id as string };
}

/**
 * Admin hard-delete of a published community item (t/748). Captures an audit
 * record (community/_removals/rem-{uuid}.json), removes the published file, and
 * clears the cached listing index so the item disappears promptly (the count
 * staleness check would also self-heal it on the next list). The route is the
 * admin gate; callers must already be authorized.
 */
export async function removeCommunityItem(
  type: 'chats' | 'debates',
  id: string,
  reason?: string,
): Promise<void> {
  assertSafeId(id, 'community id'); // block path traversal
  const backend = getUserContentBackend();
  const dir = type === 'chats' ? communityChatsDir() : communityDebatesDir();
  const prefix = type === 'chats' ? 'chat-' : 'debate-';
  const filePath = path.join(dir, `${prefix}${id}.json`);

  const raw = await backend.readFile(filePath);
  if (raw === null) throw Object.assign(new Error('Community item not found'), { statusCode: 404 });

  // Capture metadata for the audit record before deleting. Tolerate a malformed
  // file — removal must still succeed.
  let item: Record<string, unknown> = {};
  try { item = JSON.parse(raw) as Record<string, unknown>; }
  catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'community', level: 'warn',
      message: 'Removing community item with unparseable JSON',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
  const meta = (item.community_metadata && typeof item.community_metadata === 'object')
    ? item.community_metadata as Record<string, unknown> : {};
  const topic = item.topic as { final?: string; original?: string } | string | undefined;
  const removedBy = getStorageUserId();

  // Hard delete the published file, then write the audit record (so the trail
  // reflects a completed removal), then invalidate the cached listing index.
  await backend.deleteFile(filePath);

  const audit = {
    id,
    type: type === 'chats' ? 'chat' : 'debate',
    title: (item.title as string)
      || (typeof topic === 'object' ? (topic.final || topic.original) : topic)
      || 'Untitled',
    submitted_by: (meta.submitted_by_display as string) ?? null,
    removed_by: removedBy,
    removed_at: new Date().toISOString(),
    reason: reason ?? null,
  };
  await backend.writeFile(
    path.join(removalsDir(), `rem-${crypto.randomUUID()}.json`),
    JSON.stringify(audit, null, 2),
  );

  // Invalidate the listing index so the removed item drops out immediately.
  try {
    await backend.deleteFile(path.join(dir, COMMUNITY_INDEX_FILE));
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'community', level: 'warn',
      message: 'Failed to clear community listing index after removal (self-heals on next list)',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }

  log.server.info({ id, type, removedBy }, 'Community item removed');
}
