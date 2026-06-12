// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { log } from './logger.js';

interface AnonymousSession {
  chats: Map<string, unknown>;
  debates: Map<string, unknown>;
  debateComments: Map<string, unknown>;
  totalSizeBytes: number;
  lastAccessed: number;
  createdAt: number;
}

interface AnonymousSessionStoreOptions {
  maxSessions?: number;
  sessionTtlMs?: number;
  maxSessionSizeBytes?: number;
  cleanupIntervalMs?: number;
}

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function estimateSize(obj: unknown): number {
  return JSON.stringify(obj).length * 2;
}

export class AnonymousSessionStore {
  private sessions = new Map<string, AnonymousSession>();
  private maxSessions: number;
  private sessionTtlMs: number;
  private maxSessionSizeBytes: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AnonymousSessionStoreOptions = {}) {
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_TTL_MS;
    this.maxSessionSizeBytes = opts.maxSessionSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

    const interval = opts.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  private touch(session: AnonymousSession): void {
    session.lastAccessed = Date.now();
  }

  private getOrCreate(sessionId: string): AnonymousSession {
    let session = this.sessions.get(sessionId);
    if (session) {
      this.touch(session);
      return session;
    }

    if (this.sessions.size >= this.maxSessions) {
      this.evictLRU();
    }

    session = {
      chats: new Map(),
      debates: new Map(),
      debateComments: new Map(),
      totalSizeBytes: 0,
      lastAccessed: Date.now(),
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, s] of this.sessions) {
      if (s.lastAccessed < oldestTime) {
        oldestTime = s.lastAccessed;
        oldest = id;
      }
    }
    if (oldest) {
      this.sessions.delete(oldest);
      log.server.info(`Anonymous session evicted (LRU): ${oldest.slice(0, 8)}...`);
    }
  }

  // ── Chat CRUD ──

  listChats(sessionId: string): unknown[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    this.touch(session);
    const summaries: unknown[] = [];
    for (const chat of session.chats.values()) {
      const c = chat as Record<string, unknown>;
      summaries.push({
        id: c.id,
        title: c.title || 'Untitled',
        created_at: c.created_at || '',
        updated_at: c.updated_at || c.created_at || '',
        mode: c.mode || '',
        pover: c.pover || '',
      });
    }
    return summaries.sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  loadChat(sessionId: string, chatId: string): unknown | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.touch(session);
    return session.chats.get(chatId) ?? null;
  }

  saveChat(sessionId: string, chat: unknown): void {
    const session = this.getOrCreate(sessionId);
    const c = chat as { id: string };
    const oldSize = session.chats.has(c.id) ? estimateSize(session.chats.get(c.id)) : 0;
    const newSize = estimateSize(chat);
    const projectedTotal = session.totalSizeBytes - oldSize + newSize;

    if (projectedTotal > this.maxSessionSizeBytes) {
      throw Object.assign(new Error('Anonymous session storage limit exceeded'), { statusCode: 429 });
    }

    session.chats.set(c.id, chat);
    session.totalSizeBytes = projectedTotal;
    this.touch(session);
  }

  deleteChat(sessionId: string, chatId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const existing = session.chats.get(chatId);
    if (existing) {
      session.totalSizeBytes -= estimateSize(existing);
      session.chats.delete(chatId);
    }
    this.touch(session);
  }

  // ── Debate CRUD ──

  listDebates(sessionId: string): unknown[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    this.touch(session);
    const summaries: unknown[] = [];
    for (const debate of session.debates.values()) {
      const d = debate as Record<string, unknown>;
      summaries.push({
        id: d.id,
        title: d.title || d.topic || 'Untitled Debate',
        created_at: d.created_at || '',
        updated_at: d.updated_at || d.created_at || '',
        phase: d.phase || 'unknown',
      });
    }
    return summaries.sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  listDebatesMeta(sessionId: string): unknown[] {
    return this.listDebates(sessionId);
  }

  loadDebate(sessionId: string, debateId: string): unknown | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.touch(session);
    return session.debates.get(debateId) ?? null;
  }

  saveDebate(sessionId: string, debate: unknown): void {
    const session = this.getOrCreate(sessionId);
    const d = debate as { id: string };
    const oldSize = session.debates.has(d.id) ? estimateSize(session.debates.get(d.id)) : 0;
    const newSize = estimateSize(debate);
    const projectedTotal = session.totalSizeBytes - oldSize + newSize;

    if (projectedTotal > this.maxSessionSizeBytes) {
      throw Object.assign(new Error('Anonymous session storage limit exceeded'), { statusCode: 429 });
    }

    session.debates.set(d.id, debate);
    session.totalSizeBytes = projectedTotal;
    this.touch(session);
  }

  deleteDebate(sessionId: string, debateId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const existing = session.debates.get(debateId);
    if (existing) {
      session.totalSizeBytes -= estimateSize(existing);
      session.debates.delete(debateId);
    }
    // Also clean up comments
    session.debateComments.delete(debateId);
    this.touch(session);
  }

  // ── Debate comments ──

  loadDebateComments(sessionId: string, debateId: string): unknown | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.touch(session);
    return session.debateComments.get(debateId) ?? null;
  }

  saveDebateComments(sessionId: string, debateId: string, data: unknown): void {
    const session = this.getOrCreate(sessionId);
    const oldSize = session.debateComments.has(debateId) ? estimateSize(session.debateComments.get(debateId)) : 0;
    const newSize = estimateSize(data);
    session.totalSizeBytes += newSize - oldSize;
    session.debateComments.set(debateId, data);
    this.touch(session);
  }

  // ── Lifecycle ──

  cleanup(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessed > this.sessionTtlMs) {
        this.sessions.delete(id);
        evicted++;
      }
    }
    if (evicted > 0) {
      log.server.info(`Anonymous session cleanup: evicted ${evicted} expired sessions, ${this.sessions.size} remaining`);
    }
  }

  destroy(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get activeSessionCount(): number {
    return this.sessions.size;
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
