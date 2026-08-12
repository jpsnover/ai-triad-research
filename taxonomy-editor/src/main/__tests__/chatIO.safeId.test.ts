// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for M5 assertSafeId guards in chatIO.ts (t/2531).
// Verifies traversal-style IDs are rejected before path construction;
// valid IDs are accepted by loadChatSession, saveChatSession, deleteChatSession.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '{"id":"abc-123","title":"Test","created_at":"","updated_at":"","mode":"chat","pover":"acc"}'));
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    mkdirSync: mockMkdirSync,
    default: { ...actual, existsSync: mockExistsSync, readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync, mkdirSync: mockMkdirSync },
  };
});

vi.mock('../fileIO.js', () => ({
  resolveDataPath: vi.fn(() => '/fake/chats'),
}));

import { loadChatSession, saveChatSession, deleteChatSession } from '../chatIO.js';

beforeEach(() => vi.clearAllMocks());

describe('chatIO — assertSafeId traversal guards', () => {
  it.each(['../../etc/passwd', '../shadow', 'a/b', '/abs/path', 'bad id'])(
    'loadChatSession rejects "%s"', (id) => {
      expect(() => loadChatSession(id)).toThrow();
    },
  );

  it('loadChatSession accepts valid id', () => {
    expect(() => loadChatSession('abc-123')).not.toThrow();
  });

  it.each(['../../etc/passwd', '../shadow', 'a/b'])(
    'deleteChatSession rejects "%s"', (id) => {
      expect(() => deleteChatSession(id)).toThrow();
    },
  );

  it('deleteChatSession accepts valid id', () => {
    expect(() => deleteChatSession('abc-123')).not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it.each(['../../etc/passwd', '../shadow', 'a/b'])(
    'saveChatSession rejects traversal in session.id "%s"', (id) => {
      expect(() => saveChatSession({ id })).toThrow();
    },
  );

  it('saveChatSession accepts valid session.id', () => {
    expect(() => saveChatSession({ id: 'abc-123' })).not.toThrow();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
