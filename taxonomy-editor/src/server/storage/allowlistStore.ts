// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3497 (t/3495 epic — admin-managed shared Gemini key): storage for the admin
// Gemini allowlist. Persists to <stateRoot>/admin/admin-allowlist.json — the
// class-A WRITABLE state root (config.ts getStateRoot()), same family as
// feature-flags.json / runtimeConfig / the key store, via raw `fs` (the
// documented state-root exception to the StorageBackend-for-persistence rule;
// see featureFlags.ts).
//
// LOAD-BEARING SINGLE-REPLICA ASSUMPTION (TL Quality review, t/3497#2-4): the
// in-memory cache below is invalidated ONLY on this process's own writes — it
// does NOT re-read on a TTL, unlike featureFlags.ts. That is safe ONLY because
// taxonomy-editor's Azure Container App is capped at maxReplicas: 1
// (deploy/azure/main.bicep, t/2885) — a single process means "invalidate on
// write" is already fully consistent; there is no second replica to go stale.
// If maxReplicas is ever raised above 1, THIS FILE must be revisited: a removed
// user would keep access on any replica that didn't perform the removal, until
// that replica restarts (privilege persistence past the revocation window —
// this is an ACL, not a feature flag, so staleness is a security gap, not just
// an operational one). Add the featureFlags.ts TTL+re-read pattern at that
// point. t/3504 tracks extending the existing scale-guard CI gate
// (Test-InMemoryJobStoreScaleGuard.ps1) to catch this automatically.

import fs from 'fs';
import path from 'path';
import { getStateRoot } from '../config.js';
import { log } from '../logger.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import type { AllowlistEntry } from '../../../../lib/allowlist/types.js';

interface AllowlistFile {
  version: 1;
  entries: AllowlistEntry[];
}

function allowlistPath(): string {
  return path.join(getStateRoot(), 'admin', 'admin-allowlist.json');
}

/** Record + WARN a read failure — the caller fails CLOSED (empty allowlist). */
function warnUnreadable(err: unknown, p: string): void {
  log.server.warn({ err, path: p, cause: 'admin-allowlist-unreadable' },
    'admin allowlist file unreadable — failing CLOSED to an empty allowlist (t/3497)');
  getGlobalRecorder()?.record({
    type: 'system.error', component: 'allowlist-store', level: 'warn',
    message: 'Admin allowlist file unreadable — failing closed',
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

/**
 * Read admin-allowlist.json fresh (no cache). Used both to populate the cache
 * and, on the write path, as the read-modify-write base.
 * `forWrite`: distinguishes the two very different failure semantics —
 *   - read path (forWrite=false): fail-CLOSED to `[]` on ANY error (missing,
 *     corrupt, unreadable) — SO cond 1. Denying access safely is always correct.
 *   - write path (forWrite=true): ENOENT is legitimately "no file yet" (safe to
 *     start from `[]` — there is nothing on disk to lose). A parse/permission
 *     error is NOT safe to treat as `[]` here — merging a mutation onto `[]` and
 *     persisting it would silently truncate a real, unreadable-right-now
 *     allowlist to just the one entry being added. So `forWrite` re-throws on
 *     any non-ENOENT error instead, and the caller aborts the write.
 */
function readEntries(forWrite: boolean): AllowlistEntry[] {
  const p = allowlistPath();
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw) as Partial<AllowlistFile>;
    if (!Array.isArray(data.entries)) throw new Error('admin-allowlist.json: entries is not an array');
    return data.entries;
  } catch (err) {
    if (forWrite && (err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (!forWrite) { warnUnreadable(err, p); return []; }
    throw err;
  }
}

let _cache: AllowlistEntry[] | null = null;

function getCached(): AllowlistEntry[] {
  if (_cache === null) _cache = readEntries(false);
  return _cache;
}

/** All allowlist entries. Fail-CLOSED: `[]` if the file is missing, corrupt, or unreadable. */
export function getEntries(): AllowlistEntry[] {
  return getCached();
}

/** Whether `userId` is allowlisted. Keyed on `userId` only — never email (SO cond 4). */
export function isAllowlisted(userId: string): boolean {
  return getCached().some(e => e.userId === userId);
}

function persist(entries: AllowlistEntry[]): void {
  const p = allowlistPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries } satisfies AllowlistFile, null, 2));
  fs.renameSync(tmp, p);
  _cache = entries; // invalidate: the in-process cache now reflects the write
}

/** Upsert by `userId` (idempotent — a repeat add replaces the existing entry, not a duplicate). */
export async function addEntry(entry: AllowlistEntry): Promise<void> {
  const entries = readEntries(true).filter(e => e.userId !== entry.userId);
  entries.push(entry);
  persist(entries);
}

/** Idempotent: a no-op (no write, cache untouched) if `userId` isn't present. */
export async function removeEntry(userId: string): Promise<void> {
  const entries = readEntries(true);
  if (!entries.some(e => e.userId === userId)) return;
  persist(entries.filter(e => e.userId !== userId));
}

/** Test-only: reset the in-memory cache. */
export function _resetAllowlistCache(): void { _cache = null; }
