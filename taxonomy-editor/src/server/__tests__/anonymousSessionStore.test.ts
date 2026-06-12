// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { AnonymousSessionStore } from '../anonymousSessionStore.js';

describe('AnonymousSessionStore', () => {
  let store: AnonymousSessionStore;

  beforeEach(() => {
    store = new AnonymousSessionStore({
      maxSessions: 3,
      sessionTtlMs: 1000,
      maxSessionSizeBytes: 1024,
      cleanupIntervalMs: 60_000,
    });
  });

  // ── Chat CRUD ──

  describe('chat CRUD', () => {
    it('returns empty list for unknown session', () => {
      expect(store.listChats('unknown')).toEqual([]);
    });

    it('saves and loads a chat', () => {
      const chat = { id: 'c1', title: 'Test Chat', created_at: '2026-01-01' };
      store.saveChat('s1', chat);
      expect(store.loadChat('s1', 'c1')).toEqual(chat);
    });

    it('lists chats with summaries', () => {
      store.saveChat('s1', { id: 'c1', title: 'First', created_at: '2026-01-01', updated_at: '2026-01-02' });
      store.saveChat('s1', { id: 'c2', title: 'Second', created_at: '2026-01-03', updated_at: '2026-01-04' });
      const list = store.listChats('s1');
      expect(list).toHaveLength(2);
      expect((list[0] as { id: string }).id).toBe('c2');
    });

    it('deletes a chat', () => {
      store.saveChat('s1', { id: 'c1', title: 'Test' });
      store.deleteChat('s1', 'c1');
      expect(store.loadChat('s1', 'c1')).toBeNull();
    });

    it('returns null for missing chat', () => {
      expect(store.loadChat('s1', 'missing')).toBeNull();
    });
  });

  // ── Debate CRUD ──

  describe('debate CRUD', () => {
    it('saves and loads a debate', () => {
      const debate = { id: 'd1', title: 'Test Debate', created_at: '2026-01-01', phase: 'opening' };
      store.saveDebate('s1', debate);
      expect(store.loadDebate('s1', 'd1')).toEqual(debate);
    });

    it('lists debates sorted by updated_at', () => {
      store.saveDebate('s1', { id: 'd1', title: 'Old', created_at: '2026-01-01', updated_at: '2026-01-01' });
      store.saveDebate('s1', { id: 'd2', title: 'New', created_at: '2026-01-02', updated_at: '2026-01-05' });
      const list = store.listDebates('s1');
      expect((list[0] as { id: string }).id).toBe('d2');
    });

    it('deletes debate and its comments', () => {
      store.saveDebate('s1', { id: 'd1', title: 'Test' });
      store.saveDebateComments('s1', 'd1', { comments: ['a'] });
      store.deleteDebate('s1', 'd1');
      expect(store.loadDebate('s1', 'd1')).toBeNull();
      expect(store.loadDebateComments('s1', 'd1')).toBeNull();
    });
  });

  // ── Debate comments ──

  describe('debate comments', () => {
    it('saves and loads comments', () => {
      const comments = { debateId: 'd1', comments: [{ text: 'hello' }] };
      store.saveDebateComments('s1', 'd1', comments);
      expect(store.loadDebateComments('s1', 'd1')).toEqual(comments);
    });

    it('returns null for missing comments', () => {
      expect(store.loadDebateComments('s1', 'missing')).toBeNull();
    });
  });

  // ── Size limits ──

  describe('size limits', () => {
    it('throws 429 when session size exceeds limit', () => {
      const bigChat = { id: 'c1', data: 'x'.repeat(300) };
      store.saveChat('s1', bigChat);
      const bigChat2 = { id: 'c2', data: 'x'.repeat(300) };
      expect(() => store.saveChat('s1', bigChat2)).toThrow(/storage limit exceeded/i);
    });

    it('allows update that replaces existing item within limit', () => {
      store.saveChat('s1', { id: 'c1', data: 'x'.repeat(200) });
      expect(() => store.saveChat('s1', { id: 'c1', data: 'y'.repeat(200) })).not.toThrow();
    });
  });

  // ── LRU eviction ──

  describe('LRU eviction', () => {
    it('evicts oldest session when max sessions reached', () => {
      store.saveChat('s1', { id: 'c1' });
      store.saveChat('s2', { id: 'c1' });
      store.saveChat('s3', { id: 'c1' });
      // s1 is oldest — adding s4 should evict it
      store.saveChat('s4', { id: 'c1' });
      expect(store.activeSessionCount).toBe(3);
      expect(store.loadChat('s1', 'c1')).toBeNull();
      expect(store.loadChat('s4', 'c1')).toEqual({ id: 'c1' });
    });
  });

  // ── TTL cleanup ──

  describe('TTL cleanup', () => {
    it('evicts expired sessions on cleanup', () => {
      store.saveChat('s1', { id: 'c1' });
      // Advance time past TTL (1000ms)
      vi.useFakeTimers();
      vi.advanceTimersByTime(1500);
      store.cleanup();
      vi.useRealTimers();
      expect(store.listChats('s1')).toEqual([]);
      expect(store.activeSessionCount).toBe(0);
    });
  });

  // ── Lifecycle ──

  describe('lifecycle', () => {
    it('destroy removes a specific session', () => {
      store.saveChat('s1', { id: 'c1' });
      store.saveChat('s2', { id: 'c1' });
      store.destroy('s1');
      expect(store.activeSessionCount).toBe(1);
      expect(store.loadChat('s1', 'c1')).toBeNull();
      expect(store.loadChat('s2', 'c1')).toEqual({ id: 'c1' });
    });

    it('stop clears the cleanup timer', () => {
      store.stop();
      // No assertion needed — just verifying it doesn't throw
    });
  });
});
