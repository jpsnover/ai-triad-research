// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Debate + chat session persistence — extracted from fileIO.ts (ADR-007).
 *
 * Read/write/list/delete for debate sessions (plus the lightweight `_index.json`
 * and the version-aware delta merge, t/1635) and chat sessions. Anonymous users
 * route through the in-memory anon store; authenticated users hit the
 * user-content backend under `users/{id}/…`. Re-exported from fileIO.ts, so the
 * public surface and the `server/fileIO.ts → …` diagnostic locations are unchanged.
 */

import path from 'path';
import { resolveDataPath } from '../config.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { safeSerialize } from '../../../../lib/debate/persistence.js';
import { applyDebateDelta } from '../../../../lib/debate/applyDebateDelta.js';
import type { DebateDelta, DebateSession } from '../../../../lib/debate/types.js';
import { log } from '../logger.js';
import { getStorageUserId, isAnonymousUser, getAnonymousSessionId } from '../security/userContext.js';
import { getAnonymousSessionStore } from './anonymousSessionStore.js';
import { checkQuota, type QuotaCheckResult } from '../security/quotas.js';
import { getUserContentBackend, assertSafeId } from './fileIO.js';

function getAnonStore() {
  const store = getAnonymousSessionStore();
  const sessionId = getAnonymousSessionId();
  return store && sessionId ? { store, sessionId } : null;
}

// ── Debate sessions ──

function getDebatesDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('debates');
  return resolveDataPath(`users/${userId}/debates`);
}

const DEBATE_INDEX_FILE = '_index.json';

/** Read the lightweight debate index (one file read).  Returns null if the index doesn't exist. */
async function readDebateIndex(): Promise<{ id: string; title: string; created_at: string; updated_at: string; phase: string }[] | null> {
  const backend = getUserContentBackend();
  const raw = await backend.readFile(path.join(getDebatesDir(), DEBATE_INDEX_FILE));
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { /* telemetry — silent by design */ return null; }
}

/** Write the debate index to disk. */
async function writeDebateIndex(entries: { id: string; title: string; created_at: string; updated_at: string; phase: string }[]): Promise<void> {
  const backend = getUserContentBackend();
  await backend.writeFile(
    path.join(getDebatesDir(), DEBATE_INDEX_FILE),
    JSON.stringify(entries, null, 2),
  );
}

/** Upsert a single debate entry in the index. */
async function upsertDebateIndex(summary: { id: string; title: string; created_at: string; updated_at: string; phase: string }): Promise<void> {
  const entries = (await readDebateIndex()) ?? [];
  const idx = entries.findIndex(e => e.id === summary.id);
  if (idx >= 0) entries[idx] = summary;
  else entries.push(summary);
  await writeDebateIndex(entries);
}

/** Remove a debate entry from the index by ID. */
async function removeFromDebateIndex(id: string): Promise<void> {
  const entries = await readDebateIndex();
  if (!entries) return;
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length !== entries.length) await writeDebateIndex(filtered);
}

/**
 * Fast debate listing — reads a single index file instead of every debate JSON.
 * Falls back to full scan (listDebateSessions) and rebuilds the index on first call
 * or when the file count in the tree doesn't match the index (staleness check).
 */
export async function listDebateSessionsMeta(): Promise<unknown[]> {
  if (isAnonymousUser()) { const a = getAnonStore(); return a ? await a.store.listDebatesMeta(a.sessionId) : []; }
  const backend = getUserContentBackend();
  const dir = getDebatesDir();
  const cached = await readDebateIndex();
  if (cached !== null && cached.length > 0) {
    // Lightweight staleness check: compare file count from tree with index size.
    // listDirectory() uses the in-memory repoTree — zero API calls.
    try {
      const files = (await backend.listDirectory(dir))
        .filter(f => f.endsWith('.json') && f.startsWith('debate-'));
      if (files.length === cached.length) return cached;
      // Count mismatch — rebuild in background, return stale data now for speed
      void rebuildDebateIndex().catch((err) => { log.server.warn({ err }, 'Background debate index rebuild failed'); });
      return cached;
    } catch {
      /* telemetry — silent by design */
      return cached; // tree unavailable — trust the index
    }
  }
  // Cold start: full scan to build the index
  return rebuildDebateIndex();
}

/** Full-scan rebuild of the debate index. */
async function rebuildDebateIndex(): Promise<unknown[]> {
  const summaries = await listDebateSessions();
  const typed = summaries as { id: string; title: string; created_at: string; updated_at: string; phase: string; model?: string; turn_count?: number }[];
  await writeDebateIndex(typed).catch((err) => { log.server.warn({ err }, 'Debate index write failed (best-effort)'); });
  return typed;
}

export async function listDebateSessions(): Promise<unknown[]> {
  if (isAnonymousUser()) { const a = getAnonStore(); return a ? await a.store.listDebates(a.sessionId) : []; }
  const backend = getUserContentBackend();
  const dir = getDebatesDir();
  const summaries: { id: string; title: string; created_at: string; updated_at: string; phase: string; model?: string; turn_count?: number }[] = [];

  // Scan root debates dir + cli-runs subdirectory
  const scanDirs = [dir, path.join(dir, 'cli-runs')];

  for (const scanDir of scanDirs) {
    const files = (await backend.listDirectory(scanDir))
      .filter(f => f.endsWith('.json') && (f.startsWith('debate-') || f.endsWith('-debate.json')));
    for (const f of files) {
      try {
        const rawContent = await backend.readFile(path.join(scanDir, f));
        if (rawContent === null) continue;
        const raw = JSON.parse(rawContent);
        // Normalize CLI-generated filenames ({slug}-debate.json → debate-{id}.json)
        // Move cli-runs files up to the root debates dir for consistent access
        const canonical = `debate-${raw.id}.json`;
        const canonicalPath = path.join(dir, canonical);
        const currentPath = path.join(scanDir, f);
        if (currentPath !== canonicalPath) {
          await backend.writeFile(canonicalPath, rawContent);
          await backend.deleteFile(currentPath);
        }
        const transcript = Array.isArray(raw.transcript) ? raw.transcript : [];
        summaries.push({
          id: raw.id,
          title: raw.title || raw.topic || 'Untitled',
          created_at: raw.created_at || '',
          updated_at: raw.updated_at || raw.created_at || '',
          phase: raw.phase || 'unknown',
          model: raw.debate_model,
          turn_count: transcript.filter((t: { type?: string }) => t.type === 'statement' || t.type === 'opening').length,
        });
      } catch { /* telemetry — silent by design;  skip */ }
    }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadDebateSession(id: string): Promise<unknown> {
  assertSafeId(id, 'debate id');
  if (isAnonymousUser()) {
    const a = getAnonStore();
    const data = a ? await a.store.loadDebate(a.sessionId, id) : null;
    if (data === null) throw new ActionableError({ goal: 'Load debate session', problem: `Debate session not found: ${id}`, location: 'server/fileIO.ts → loadDebateSession (anonymous)', nextSteps: ['Verify the debate ID exists'] });
    return data;
  }
  const backend = getUserContentBackend();
  const filePath = path.join(getDebatesDir(), `debate-${id}.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) throw new ActionableError({
    goal: 'Load debate session',
    problem: `Debate session not found: ${id}`,
    location: 'server/fileIO.ts → loadDebateSession',
    nextSteps: ['Verify the debate ID exists via listDebateSessions()'],
  });
  return JSON.parse(raw);
}

/** Debate quota status for the current (non-anonymous) user — the exact count +
 *  cap the save path enforces. Shared by saveDebateSession and the read-only
 *  GET /api/debates/quota-status pre-check (t/1360) so the pre-check can never
 *  diverge from enforcement (Shared Utility Rule). */
export async function getDebatesQuotaStatus(): Promise<QuotaCheckResult> {
  const files = (await getUserContentBackend().listDirectory(getDebatesDir()))
    .filter(f => f.startsWith('debate-') && f.endsWith('.json'));
  return checkQuota('debates', files.length);
}

export async function saveDebateSession(session: unknown): Promise<void> {
  const s = session as { id: string; title?: string; topic?: { final?: string; original?: string }; created_at?: string; updated_at?: string; phase?: string };
  assertSafeId(s.id, 'debate id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.saveDebate(a.sessionId, session); return; }
  const backend = getUserContentBackend();
  const debatePath = path.join(getDebatesDir(), `debate-${s.id}.json`);
  const isNew = (await backend.readFile(debatePath)) === null;
  if (isNew) {
    const q = await getDebatesQuotaStatus();
    if (!q.allowed) {
      throw Object.assign(new ActionableError({ goal: 'Save debate session', problem: `Debate quota exceeded (${q.current}/${q.limit})`, location: 'server/fileIO.ts → saveDebateSession', nextSteps: ['Delete existing debates to free space'] }), { statusCode: 429, quotaInfo: q });
    }
  }
  const { json, hadError, errorMessage } = safeSerialize(session, 2);
  if (hadError) {
    log.server.warn({ debateId: s.id, errorMessage }, 'Debate session serialized with sanitizing replacer — non-serializable fields stripped');
  }
  await backend.writeFile(debatePath, json);
  // Maintain the lightweight index
  void upsertDebateIndex({
    id: s.id,
    title: s.title || s.topic?.final || s.topic?.original || 'Untitled',
    created_at: s.created_at || '',
    updated_at: s.updated_at || s.created_at || '',
    phase: s.phase || 'unknown',
  }).catch((err) => { log.server.warn({ err }, 'Debate index upsert failed (best-effort)'); });
}

/** Build the typed 409 version-conflict error carrying the server's current
 *  `_saveVersion` (null when no stored session exists). The client maps this to
 *  a re-read + full PUT, so a missing blob self-heals on the next save. */
function debateVersionConflict(debateId: string, currentVersion: number | null): ActionableError {
  return Object.assign(new ActionableError({
    goal: 'Apply an incremental debate-save delta to the stored session',
    problem: currentVersion === null
      ? `No stored debate session found for delta apply: ${debateId}`
      : `Delta baseVersion does not match the stored _saveVersion (${currentVersion}) for debate ${debateId}`,
    location: 'server/fileIO.ts → applyDebateDeltaToStorage',
    nextSteps: ['Re-read the full session, recompute against the returned currentVersion, and retry as a full PUT.'],
  }), { statusCode: 409, code: 'version_conflict', currentVersion });
}

/**
 * Version-aware read-merge-write for an incremental debate save (t/1635).
 *
 * Reads the stored session, checks its `_saveVersion` (absent ⇒ 0) against
 * `delta.baseVersion`, and on an exact match applies the shared pure merge
 * (`applyDebateDelta`, t/1634), writes the full merged blob, and returns the
 * bumped `{ newVersion }`. On any mismatch — or when no stored session exists —
 * throws a typed 409 carrying `currentVersion` so the client falls back to a
 * full PUT. Azure Blob has no partial write: the whole merged blob is still
 * written; the win is the client→server *upload* size only.
 *
 * The current user (real, anonymous, or `_local`) is resolved from
 * AsyncLocalStorage context exactly as `saveDebateSession` does — no userId
 * param. Anonymous sessions merge-and-mirror through the same anon store, so
 * anonymous callers pay the same uplink saving (the entire point of the delta).
 */
async function applyDeltaAnon(delta: DebateDelta): Promise<{ newVersion: number }> {
  const a = getAnonStore();
  const loaded = a ? await a.store.loadDebate(a.sessionId, delta.debateId) : null;
  if (loaded === null || a === null) throw debateVersionConflict(delta.debateId, null);
  const existing = loaded as DebateSession;
  const currentVersion = existing._saveVersion ?? 0;
  if (delta.baseVersion !== currentVersion) throw debateVersionConflict(delta.debateId, currentVersion);
  const merged = applyDebateDelta(existing, delta);
  await a.store.saveDebate(a.sessionId, merged);
  return { newVersion: merged._saveVersion ?? 0 };
}

function buildDebateIndexEntry(id: string, merged: DebateSession): { id: string; title: string; created_at: string; updated_at: string; phase: string } {
  const m = merged as { title?: string; topic?: { final?: string; original?: string }; created_at?: string; updated_at?: string; phase?: string };
  return {
    id,
    title: m.title || m.topic?.final || m.topic?.original || 'Untitled',
    created_at: m.created_at || '',
    updated_at: m.updated_at || m.created_at || '',
    phase: m.phase || 'unknown',
  };
}

export async function applyDebateDeltaToStorage(delta: DebateDelta): Promise<{ newVersion: number }> {
  assertSafeId(delta.debateId, 'debate id');

  if (isAnonymousUser()) return applyDeltaAnon(delta);

  const backend = getUserContentBackend();
  const debatePath = path.join(getDebatesDir(), `debate-${delta.debateId}.json`);
  const raw = await backend.readFile(debatePath);
  if (raw === null) throw debateVersionConflict(delta.debateId, null);
  const existing = JSON.parse(raw) as DebateSession;
  const currentVersion = existing._saveVersion ?? 0;
  if (delta.baseVersion !== currentVersion) throw debateVersionConflict(delta.debateId, currentVersion);

  const merged = applyDebateDelta(existing, delta);
  const { json, hadError, errorMessage } = safeSerialize(merged, 2);
  if (hadError) {
    log.server.warn({ debateId: delta.debateId, errorMessage }, 'Delta-merged debate session serialized with sanitizing replacer — non-serializable fields stripped');
  }
  await backend.writeFile(debatePath, json);
  void upsertDebateIndex(buildDebateIndexEntry(delta.debateId, merged))
    .catch((err) => { log.server.warn({ err }, 'Debate index upsert failed (best-effort)'); });

  return { newVersion: merged._saveVersion ?? 0 };
}

export async function deleteDebateSession(id: string): Promise<void> {
  assertSafeId(id, 'debate id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.deleteDebate(a.sessionId, id); return; }
  const backend = getUserContentBackend();
  await backend.deleteFile(path.join(getDebatesDir(), `debate-${id}.json`));
  void removeFromDebateIndex(id).catch((err) => { log.server.warn({ err, debateId: id }, 'Debate index removal failed (best-effort)'); });
}

export async function loadDebateComments(debateId: string): Promise<unknown> {
  assertSafeId(debateId, 'debate id');
  if (isAnonymousUser()) {
    const a = getAnonStore();
    return (await a?.store.loadDebateComments(a.sessionId, debateId)) ?? { _schema_version: '1', debateId, comments: [] };
  }
  const backend = getUserContentBackend();
  const filePath = path.join(getDebatesDir(), `debate-${debateId}-comments.json`);
  const raw = await backend.readFile(filePath);
  if (raw === null) {
    return { _schema_version: '1', debateId, comments: [] };
  }
  return JSON.parse(raw);
}

export async function saveDebateComments(debateId: string, data: unknown): Promise<void> {
  assertSafeId(debateId, 'debate id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.saveDebateComments(a.sessionId, debateId, data); return; }
  const backend = getUserContentBackend();
  await backend.writeFile(
    path.join(getDebatesDir(), `debate-${debateId}-comments.json`),
    JSON.stringify(data, null, 2),
  );
}

// ── Chat sessions ──

function getChatsDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('chats');
  return resolveDataPath(`users/${userId}/chats`);
}

export async function listChatSessions(): Promise<unknown[]> {
  if (isAnonymousUser()) { const a = getAnonStore(); return a ? await a.store.listChats(a.sessionId) : []; }
  const backend = getUserContentBackend();
  const dir = getChatsDir();
  const files = (await backend.listDirectory(dir)).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
  const summaries: { id: string; title: string; created_at: string; updated_at: string; mode: string; pover: string }[] = [];
  for (const f of files) {
    try {
      const raw = await backend.readFile(path.join(dir, f));
      if (raw === null) continue;
      const parsed = JSON.parse(raw);
      summaries.push({
        id: parsed.id,
        title: parsed.title || 'Untitled',
        created_at: parsed.created_at || '',
        updated_at: parsed.updated_at || parsed.created_at || '',
        mode: parsed.mode || '',
        pover: parsed.pover || '',
      });
    } catch { /* telemetry — silent by design;  skip */ }
  }
  return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadChatSession(id: string): Promise<unknown> {
  assertSafeId(id, 'chat id');
  if (isAnonymousUser()) {
    const a = getAnonStore();
    const data = a ? await a.store.loadChat(a.sessionId, id) : null;
    if (data === null) throw new ActionableError({ goal: 'Load chat session', problem: `Chat session not found: ${id}`, location: 'server/fileIO.ts → loadChatSession (anonymous)', nextSteps: ['Verify the chat ID exists'] });
    return data;
  }
  const backend = getUserContentBackend();
  const raw = await backend.readFile(path.join(getChatsDir(), `chat-${id}.json`));
  if (raw === null) throw new ActionableError({
    goal: 'Load chat session',
    problem: `Chat session not found: ${id}`,
    location: 'server/fileIO.ts → loadChatSession',
    nextSteps: ['Verify the chat ID exists via listChatSessions()'],
  });
  return JSON.parse(raw);
}

export async function saveChatSession(session: unknown): Promise<void> {
  const s = session as { id: string };
  assertSafeId(s.id, 'chat id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.saveChat(a.sessionId, session); return; }
  const backend = getUserContentBackend();
  const chatPath = path.join(getChatsDir(), `chat-${s.id}.json`);
  const isNew = (await backend.readFile(chatPath)) === null;
  if (isNew) {
    const files = (await backend.listDirectory(getChatsDir())).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
    const q = checkQuota('chats', files.length);
    if (!q.allowed) {
      throw Object.assign(new ActionableError({ goal: 'Save chat session', problem: `Chat quota exceeded (${q.current}/${q.limit})`, location: 'server/fileIO.ts → saveChatSession', nextSteps: ['Delete existing chats to free space'] }), { statusCode: 429, quotaInfo: q });
    }
  }
  await backend.writeFile(chatPath, JSON.stringify(session, null, 2));
}

export async function deleteChatSession(id: string): Promise<void> {
  assertSafeId(id, 'chat id');
  if (isAnonymousUser()) { const a = getAnonStore(); if (a) await a.store.deleteChat(a.sessionId, id); return; }
  const backend = getUserContentBackend();
  await backend.deleteFile(path.join(getChatsDir(), `chat-${id}.json`));
}
