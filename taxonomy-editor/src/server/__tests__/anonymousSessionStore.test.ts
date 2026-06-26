// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { AnonymousSessionStore } from '../storage/anonymousSessionStore.js';

describe('AnonymousSessionStore (file-backed, t/683)', () => {
  let store: AnonymousSessionStore;
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-store-'));
    store = new AnonymousSessionStore({
      baseDir,
      maxSessions: 3,
      sessionTtlMs: 1000,
      maxSessionSizeBytes: 1024,
      cleanupIntervalMs: 60_000,
    });
  });

  afterEach(() => {
    store.stop();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  /** Backdate a session's access time so TTL/LRU logic can be tested deterministically. */
  function setAccessTime(sessionId: string, msAgo: number) {
    const t = new Date(Date.now() - msAgo);
    fs.utimesSync(path.join(baseDir, sessionId), t, t);
  }

  // ── Chat CRUD ──

  describe('chat CRUD', () => {
    it('returns empty list for unknown session', async () => {
      expect(await store.listChats('unknown')).toEqual([]);
    });

    it('saves and loads a chat', async () => {
      const chat = { id: 'c1', title: 'Test Chat', created_at: '2026-01-01' };
      await store.saveChat('s1', chat);
      expect(await store.loadChat('s1', 'c1')).toEqual(chat);
    });

    it('lists chats with summaries sorted by updated_at desc', async () => {
      await store.saveChat('s1', { id: 'c1', title: 'First', created_at: '2026-01-01', updated_at: '2026-01-02' });
      await store.saveChat('s1', { id: 'c2', title: 'Second', created_at: '2026-01-03', updated_at: '2026-01-04' });
      const list = await store.listChats('s1');
      expect(list).toHaveLength(2);
      expect((list[0] as { id: string }).id).toBe('c2');
    });

    it('deletes a chat', async () => {
      await store.saveChat('s1', { id: 'c1', title: 'Test' });
      await store.deleteChat('s1', 'c1');
      expect(await store.loadChat('s1', 'c1')).toBeNull();
    });

    it('returns null for missing chat', async () => {
      expect(await store.loadChat('s1', 'missing')).toBeNull();
    });
  });

  // ── Debate CRUD ──

  describe('debate CRUD', () => {
    it('saves and loads a debate', async () => {
      const debate = { id: 'd1', title: 'Test Debate', created_at: '2026-01-01', phase: 'opening' };
      await store.saveDebate('s1', debate);
      expect(await store.loadDebate('s1', 'd1')).toEqual(debate);
    });

    it('lists debates sorted by updated_at', async () => {
      await store.saveDebate('s1', { id: 'd1', title: 'Old', created_at: '2026-01-01', updated_at: '2026-01-01' });
      await store.saveDebate('s1', { id: 'd2', title: 'New', created_at: '2026-01-02', updated_at: '2026-01-05' });
      const list = await store.listDebates('s1');
      expect((list[0] as { id: string }).id).toBe('d2');
    });

    it('deletes debate and its comments', async () => {
      await store.saveDebate('s1', { id: 'd1', title: 'Test' });
      await store.saveDebateComments('s1', 'd1', { comments: ['a'] });
      await store.deleteDebate('s1', 'd1');
      expect(await store.loadDebate('s1', 'd1')).toBeNull();
      expect(await store.loadDebateComments('s1', 'd1')).toBeNull();
    });
  });

  // ── Debate comments ──

  describe('debate comments', () => {
    it('saves and loads comments', async () => {
      const comments = { debateId: 'd1', comments: [{ text: 'hello' }] };
      await store.saveDebateComments('s1', 'd1', comments);
      expect(await store.loadDebateComments('s1', 'd1')).toEqual(comments);
    });

    it('returns null for missing comments', async () => {
      expect(await store.loadDebateComments('s1', 'missing')).toBeNull();
    });
  });

  // ── Cross-"replica" durability (a second store over the same dir) ──

  it('a second store instance over the same baseDir sees the data (replica-independent)', async () => {
    await store.saveDebate('s1', { id: 'd1', title: 'Shared' });
    const other = new AnonymousSessionStore({ baseDir, cleanupIntervalMs: 60_000 });
    try {
      expect(await other.loadDebate('s1', 'd1')).toEqual({ id: 'd1', title: 'Shared' });
    } finally {
      other.stop();
    }
  });

  // ── Size limits (byte-accurate) ──

  describe('size limits', () => {
    it('throws 429 when session size exceeds limit', async () => {
      await store.saveChat('s1', { id: 'c1', data: 'x'.repeat(600) });
      await expect(store.saveChat('s1', { id: 'c2', data: 'x'.repeat(600) }))
        .rejects.toThrow(/storage limit exceeded/i);
    });

    it('allows update that replaces existing item within limit', async () => {
      await store.saveChat('s1', { id: 'c1', data: 'x'.repeat(600) });
      await expect(store.saveChat('s1', { id: 'c1', data: 'y'.repeat(600) })).resolves.toBeUndefined();
    });
  });

  // ── New session initialization (t/1060) ──

  describe('new session initialization (t/1060)', () => {
    it('first write on brand-new session succeeds without false 429', async () => {
      const debate = { id: 'd1', title: 'First Debate', created_at: '2026-01-01' };
      await expect(store.saveDebate('brand-new', debate)).resolves.toBeUndefined();
      expect(await store.loadDebate('brand-new', 'd1')).toEqual(debate);
    });

    it('genuine storage limit exceeded returns 429 statusCode', async () => {
      await store.saveChat('s1', { id: 'c1', data: 'x'.repeat(600) });
      try {
        await store.saveChat('s1', { id: 'c2', data: 'x'.repeat(600) });
        expect.fail('Expected storage limit error');
      } catch (err) {
        expect((err as Error).message).toMatch(/storage limit exceeded/i);
        expect((err as { statusCode: number }).statusCode).toBe(429);
      }
    });
  });

  // ── LRU eviction ──

  describe('LRU eviction', () => {
    it('evicts the least-recently-accessed session when max sessions reached', async () => {
      await store.saveChat('s1', { id: 'c1' });
      await store.saveChat('s2', { id: 'c1' });
      await store.saveChat('s3', { id: 'c1' });
      // Make s1 the oldest by access time.
      setAccessTime('s1', 3000);
      setAccessTime('s2', 2000);
      setAccessTime('s3', 1000);

      await store.saveChat('s4', { id: 'c1' }); // 4th session → evict oldest (s1)

      expect(await store.activeSessionCount()).toBe(3);
      expect(await store.loadChat('s1', 'c1')).toBeNull();
      expect(await store.loadChat('s4', 'c1')).toEqual({ id: 'c1' });
    });
  });

  // ── TTL cleanup ──

  describe('TTL cleanup', () => {
    it('evicts expired sessions on cleanup', async () => {
      await store.saveChat('s1', { id: 'c1' });
      setAccessTime('s1', 5000); // older than the 1000ms TTL
      await store.cleanup();
      expect(await store.listChats('s1')).toEqual([]);
      expect(await store.activeSessionCount()).toBe(0);
    });

    it('keeps sessions accessed within the TTL', async () => {
      await store.saveChat('s1', { id: 'c1' });
      await store.cleanup();
      expect(await store.activeSessionCount()).toBe(1);
    });
  });

  // ── Lifecycle ──

  describe('lifecycle', () => {
    it('destroy removes a specific session', async () => {
      await store.saveChat('s1', { id: 'c1' });
      await store.saveChat('s2', { id: 'c1' });
      await store.destroy('s1');
      expect(await store.activeSessionCount()).toBe(1);
      expect(await store.loadChat('s1', 'c1')).toBeNull();
      expect(await store.loadChat('s2', 'c1')).toEqual({ id: 'c1' });
    });

    it('stop clears the cleanup timer', () => {
      store.stop();
      // No assertion needed — just verifying it doesn't throw
    });
  });

  // ── Path-traversal safety ──

  it('rejects session ids containing path traversal', async () => {
    await expect(store.saveChat('../evil', { id: 'c1' })).rejects.toThrow(/invalid anonymous/i);
    await expect(store.loadChat('s1', '../../etc/passwd')).rejects.toThrow(/invalid anonymous/i);
  });
});
