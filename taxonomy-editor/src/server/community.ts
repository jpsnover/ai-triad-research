// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import crypto from 'crypto';
import { resolveDataPath } from './config.js';
import { getUserContentBackend } from './fileIO.js';
import { getStorageUserId, isAnonymousUser } from './userContext.js';
import { log } from './logger.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import path from 'path';

// ── Paths ──

function communityChatsDir(): string { return resolveDataPath('community/chats'); }
function communityDebatesDir(): string { return resolveDataPath('community/debates'); }
function submissionsDir(): string { return resolveDataPath('community/_submissions'); }

// ── Admin ──

function getAdminUsers(): string[] {
  return (process.env.ADMIN_USERS || 'jpsnover').split(',').map(s => s.trim());
}

export function isAdmin(userId?: string): boolean {
  const uid = userId ?? getStorageUserId();
  return uid !== '_local' && getAdminUsers().includes(uid);
}

// ── Community read ──

export async function listCommunityChats(): Promise<unknown[]> {
  const backend = getUserContentBackend();
  const dir = communityChatsDir();
  const files = (await backend.listDirectory(dir, { ref: 'main' })).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
  const items: unknown[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f), { ref: 'main' });
      if (raw === null) continue;
      const parsed = JSON.parse(raw);
      items.push({
        id: parsed.id,
        title: parsed.title || 'Untitled',
        created_at: parsed.created_at || '',
        updated_at: parsed.updated_at || parsed.created_at || '',
        mode: parsed.mode || '',
        community_metadata: parsed.community_metadata || null,
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'community',
        level: 'warn',
        message: 'Skipping malformed community chat file',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      /* skip malformed */
    }
  }
  return items.sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function listCommunityDebates(): Promise<unknown[]> {
  const backend = getUserContentBackend();
  const dir = communityDebatesDir();
  const files = (await backend.listDirectory(dir, { ref: 'main' })).filter(f => f.startsWith('debate-') && f.endsWith('.json'));
  const items: unknown[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f), { ref: 'main' });
      if (raw === null) continue;
      const parsed = JSON.parse(raw);
      items.push({
        id: parsed.id,
        title: parsed.title || parsed.topic?.final || parsed.topic?.original || 'Untitled Debate',
        created_at: parsed.created_at || '',
        updated_at: parsed.updated_at || parsed.created_at || '',
        phase: parsed.phase || 'unknown',
        community_metadata: parsed.community_metadata || null,
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'community',
        level: 'warn',
        message: 'Skipping malformed community debate file',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      /* skip malformed */
    }
  }
  return items.sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function loadCommunityItem(type: 'chats' | 'debates', id: string): Promise<unknown | null> {
  const backend = getUserContentBackend();
  const dir = type === 'chats' ? communityChatsDir() : communityDebatesDir();
  const prefix = type === 'chats' ? 'chat-' : 'debate-';
  const raw = await backend.readFile(path.join(dir, `${prefix}${id}.json`), { ref: 'main' });
  return raw ? JSON.parse(raw) : null;
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

  // Rate limit: max 20 pending submissions per user
  const existing = await listSubmissionsForUser(userId);
  const pending = existing.filter(s => s.status === 'pending');
  if (pending.length >= 20) {
    throw Object.assign(new Error('Maximum 20 pending submissions allowed'), { statusCode: 429 });
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

  // Submissions are shared data on main — submitters (often without a session
  // branch / merge rights) need them visible to admins immediately, so commit
  // straight to main rather than the submitter's session overlay (t/694).
  await backend.writeFile(
    path.join(dir, `sub-${submissionId}.json`),
    JSON.stringify(submission, null, 2),
    { ref: 'main' },
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
  const files = (await backend.listDirectory(dir, { ref: 'main' })).filter(f => f.startsWith('sub-') && f.endsWith('.json'));
  const subs: Submission[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f), { ref: 'main' });
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
  const files = (await backend.listDirectory(dir, { ref: 'main' })).filter(f => f.startsWith('sub-') && f.endsWith('.json'));
  const subs: Submission[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f), { ref: 'main' });
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
    if (typeof value === 'string' && /^(sk-|AIza|gsk_|key-|xai-|Bearer\s)/.test(value)) continue;
    result[key] = stripSensitiveKeys(value);
  }
  return result;
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
  const backend = getUserContentBackend();
  const subPath = path.join(submissionsDir(), `sub-${submissionId}.json`);
  const raw = await backend.readFile(subPath, { ref: 'main' });
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
  const backend = getUserContentBackend();
  const subPath = path.join(submissionsDir(), `sub-${submissionId}.json`);
  const raw = await backend.readFile(subPath, { ref: 'main' });
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
  const { saveChatSession, saveDebateSession } = await import('./fileIO.js');
  if (type === 'chats') {
    await saveChatSession(copy);
  } else {
    await saveDebateSession(copy);
  }

  return { newId: copy.id as string };
}
