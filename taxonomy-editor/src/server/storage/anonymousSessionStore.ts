// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { log } from '../logger.js';
import { getConfig } from '../runtimeConfig.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

/**
 * Replica-independent store for anonymous (not-signed-in) users' ephemeral
 * chats, debates, and debate comments.
 *
 * Backed by a shared filesystem (an Azure Files volume mounted at /mnt/shared in
 * production — see t/683) so any container replica can serve a given session.
 * Previously this was per-process in-memory Maps, which broke when a request
 * (e.g. a debate popout window) was routed to a different replica than the one
 * that created the data.
 *
 * Layout:  <baseDir>/<sessionId>/{chats,debates,comments}/<id>.json
 *
 * - lastAccessed is the session directory's mtime, touched on every read/write,
 *   so TTL/LRU work across replicas without shared in-memory bookkeeping.
 * - All methods are async (network filesystem — never block the event loop).
 * - Concurrent writes across replicas are last-write-wins, acceptable for
 *   low-stakes ephemeral anonymous data.
 */

interface AnonymousSessionStoreOptions {
  /** Root directory for session files. Defaults to ANON_SESSION_DIR, then
   *  /mnt/shared/anon-sessions if that mount exists, else an OS temp dir. */
  baseDir?: string;
  maxSessions?: number;
  sessionTtlMs?: number;
  maxSessionSizeBytes?: number;
  cleanupIntervalMs?: number;
}

// t/929: TTL / max-sessions / max-size now come from runtime-config
// (getConfig().sessions.*), sourced at construction (init time). The cleanup
// interval stays a constant — restart-required timer (spec §2.12).
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const SHARED_MOUNT = '/mnt/shared';
type Kind = 'chats' | 'debates' | 'comments';

function defaultBaseDir(): string {
  if (process.env.ANON_SESSION_DIR) return process.env.ANON_SESSION_DIR;
  try {
    if (fs.existsSync(SHARED_MOUNT)) return path.join(SHARED_MOUNT, 'anon-sessions');
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'anonymous-session-store',
      level: 'warn',
      message: 'Failed to stat shared mount; falling back to temp dir',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    /* not mounted — fall through to temp */
  }
  return path.join(os.tmpdir(), 'aitriad-anon-sessions');
}

/** Restrict a session/item id to a path-safe token (no traversal). */
function safeSegment(id: string, label: string): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
    throw Object.assign(new Error(`Invalid anonymous ${label}`), { statusCode: 400 });
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw Object.assign(new Error(`Invalid anonymous ${label}`), { statusCode: 400 });
  }
  return id;
}

export class AnonymousSessionStore {
  private baseDir: string;
  private maxSessions: number;
  private sessionTtlMs: number;
  private maxSessionSizeBytes: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AnonymousSessionStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
    this.maxSessions = opts.maxSessions ?? getConfig().sessions.anonymousMaxSessions;
    this.sessionTtlMs = opts.sessionTtlMs ?? getConfig().sessions.anonymousTtlMs;
    this.maxSessionSizeBytes = opts.maxSessionSizeBytes ?? getConfig().sessions.anonymousMaxSizeBytes;

    const interval = opts.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupTimer = setInterval(() => { this.cleanup().catch(() => { /* sweep is best-effort */ }); }, interval);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  // ── Path helpers ──

  private sessionDir(sessionId: string): string {
    return path.join(this.baseDir, safeSegment(sessionId, 'session id'));
  }
  private kindDir(sessionId: string, kind: Kind): string {
    return path.join(this.sessionDir(sessionId), kind);
  }
  private itemPath(sessionId: string, kind: Kind, id: string): string {
    return path.join(this.kindDir(sessionId, kind), `${safeSegment(id, 'item id')}.json`);
  }

  /** Update the session directory's mtime to now (best-effort access marker). */
  private async touch(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    const now = new Date();
    try { await fsp.utimes(dir, now, now); } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'anonymous-session-store',
        level: 'warn',
        message: 'Failed to touch session dir mtime',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      /* dir may not exist yet */
    }
  }

  /** Sum of all file sizes under a session directory. */
  private async sessionSize(sessionId: string): Promise<number> {
    let total = 0;
    for (const kind of ['chats', 'debates', 'comments'] as Kind[]) {
      const dir = this.kindDir(sessionId, kind);
      let files: string[];
      try { files = await fsp.readdir(dir); } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'anonymous-session-store',
            level: 'warn',
            message: 'Failed to read kind dir while sizing session',
            error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
          });
        }
        continue;
      }
      for (const f of files) {
        try { total += (await fsp.stat(path.join(dir, f))).size; } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            getGlobalRecorder()?.record({
              type: 'system.error',
              component: 'anonymous-session-store',
              level: 'warn',
              message: 'Failed to stat file while sizing session',
              error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
            });
          }
        }
      }
    }
    return total;
  }

  private async readJson(filePath: string): Promise<unknown | null> {
    try {
      return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'anonymous-session-store',
          level: 'warn',
          message: 'Failed to read/parse session JSON file',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
      return null;
    }
  }

  /**
   * Write an item, enforcing the per-session size cap. Evicts the LRU session
   * first if this is a brand-new session that would exceed maxSessions.
   */
  private async writeItem(sessionId: string, kind: Kind, id: string, value: unknown): Promise<void> {
    const dir = this.kindDir(sessionId, kind);
    const file = this.itemPath(sessionId, kind, id);

    const isNewSession = !fs.existsSync(this.sessionDir(sessionId));
    if (isNewSession) await this.evictIfFull();

    await fsp.mkdir(dir, { recursive: true });

    const serialized = JSON.stringify(value);
    const newSize = Buffer.byteLength(serialized, 'utf-8');
    let oldSize = 0;
    try { oldSize = (await fsp.stat(file)).size; } catch {
      /* telemetry — silent by design: new item, file doesn't exist yet */
    }
    const projected = (await this.sessionSize(sessionId)) - oldSize + newSize;
    if (projected > this.maxSessionSizeBytes) {
      throw Object.assign(new Error('Anonymous session storage limit exceeded'), { statusCode: 429 });
    }

    await fsp.writeFile(file, serialized);
    await this.touch(sessionId);
  }

  private async evictIfFull(): Promise<void> {
    let entries: string[];
    try { entries = await fsp.readdir(this.baseDir); } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'anonymous-session-store',
        level: 'warn',
        message: 'Failed to read base dir during eviction check',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return;
    }
    if (entries.length < this.maxSessions) return;

    // Evict the least-recently-accessed session (oldest dir mtime).
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const name of entries) {
      try {
        const m = (await fsp.stat(path.join(this.baseDir, name))).mtimeMs;
        if (m < oldestTime) { oldestTime = m; oldest = name; }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'anonymous-session-store',
          level: 'warn',
          message: 'Failed to stat session dir during LRU eviction',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        /* skip */
      }
    }
    if (oldest) {
      try {
        await fsp.rm(path.join(this.baseDir, oldest), { recursive: true, force: true });
        log.server.info(`Anonymous session evicted (LRU): ${oldest.slice(0, 8)}...`);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'anonymous-session-store',
          level: 'warn',
          message: 'Failed to evict LRU session; proceeding with new session',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    }
  }

  private async listKind(sessionId: string, kind: Kind): Promise<Record<string, unknown>[]> {
    const dir = this.kindDir(sessionId, kind);
    let files: string[];
    try { files = await fsp.readdir(dir); } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'anonymous-session-store',
        level: 'warn',
        message: 'Failed to read kind dir; returning empty list',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return [];
    }
    const items: Record<string, unknown>[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const data = await this.readJson(path.join(dir, f));
      if (data && typeof data === 'object') items.push(data as Record<string, unknown>);
    }
    await this.touch(sessionId);
    return items;
  }

  // ── Chat CRUD ──

  async listChats(sessionId: string): Promise<unknown[]> {
    const chats = await this.listKind(sessionId, 'chats');
    return chats.map(c => ({
      id: c.id,
      title: c.title || 'Untitled',
      created_at: c.created_at || '',
      updated_at: c.updated_at || c.created_at || '',
      mode: c.mode || '',
      pover: c.pover || '',
    })).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  async loadChat(sessionId: string, chatId: string): Promise<unknown | null> {
    const data = await this.readJson(this.itemPath(sessionId, 'chats', chatId));
    if (data !== null) await this.touch(sessionId);
    return data;
  }

  async saveChat(sessionId: string, chat: unknown): Promise<void> {
    const c = chat as { id: string };
    await this.writeItem(sessionId, 'chats', c.id, chat);
  }

  async deleteChat(sessionId: string, chatId: string): Promise<void> {
    await fsp.rm(this.itemPath(sessionId, 'chats', chatId), { force: true });
    await this.touch(sessionId);
  }

  // ── Debate CRUD ──

  async listDebates(sessionId: string): Promise<unknown[]> {
    const debates = await this.listKind(sessionId, 'debates');
    return debates.map(d => ({
      id: d.id,
      title: d.title || d.topic || 'Untitled Debate',
      created_at: d.created_at || '',
      updated_at: d.updated_at || d.created_at || '',
      phase: d.phase || 'unknown',
    })).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  async listDebatesMeta(sessionId: string): Promise<unknown[]> {
    return this.listDebates(sessionId);
  }

  async loadDebate(sessionId: string, debateId: string): Promise<unknown | null> {
    const data = await this.readJson(this.itemPath(sessionId, 'debates', debateId));
    if (data !== null) await this.touch(sessionId);
    return data;
  }

  async saveDebate(sessionId: string, debate: unknown): Promise<void> {
    const d = debate as { id: string };
    await this.writeItem(sessionId, 'debates', d.id, debate);
  }

  async deleteDebate(sessionId: string, debateId: string): Promise<void> {
    await fsp.rm(this.itemPath(sessionId, 'debates', debateId), { force: true });
    // Also clean up comments
    await fsp.rm(this.itemPath(sessionId, 'comments', debateId), { force: true });
    await this.touch(sessionId);
  }

  // ── Debate comments ──

  async loadDebateComments(sessionId: string, debateId: string): Promise<unknown | null> {
    const data = await this.readJson(this.itemPath(sessionId, 'comments', debateId));
    if (data !== null) await this.touch(sessionId);
    return data;
  }

  async saveDebateComments(sessionId: string, debateId: string, data: unknown): Promise<void> {
    await this.writeItem(sessionId, 'comments', debateId, data);
  }

  // ── Lifecycle ──

  /** Delete sessions whose last access (dir mtime) is older than the TTL. */
  async cleanup(): Promise<void> {
    let entries: string[];
    try { entries = await fsp.readdir(this.baseDir); } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'anonymous-session-store',
        level: 'warn',
        message: 'Failed to read base dir during cleanup sweep',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return;
    }
    const now = Date.now();
    let evicted = 0;
    for (const name of entries) {
      const dir = path.join(this.baseDir, name);
      try {
        if (now - (await fsp.stat(dir)).mtimeMs > this.sessionTtlMs) {
          await fsp.rm(dir, { recursive: true, force: true });
          evicted++;
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'anonymous-session-store',
          level: 'warn',
          message: 'Failed to stat/remove session dir during cleanup',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        /* skip */
      }
    }
    if (evicted > 0) {
      log.server.info(`Anonymous session cleanup: evicted ${evicted} expired sessions`);
    }
  }

  async destroy(sessionId: string): Promise<void> {
    await fsp.rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async activeSessionCount(): Promise<number> {
    try { return (await fsp.readdir(this.baseDir)).length; } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'anonymous-session-store',
        level: 'warn',
        message: 'Failed to read base dir for active session count',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return 0;
    }
  }
}

let globalStore: AnonymousSessionStore | null = null;

export function initAnonymousSessionStore(opts?: AnonymousSessionStoreOptions): AnonymousSessionStore {
  if (globalStore) globalStore.stop();
  globalStore = new AnonymousSessionStore(opts);
  return globalStore;
}

export function getAnonymousSessionStore(): AnonymousSessionStore | null {
  return globalStore;
}
