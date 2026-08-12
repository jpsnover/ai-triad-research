// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for M5 assertSafeId guards in debateIO.ts (t/2531).
// Verifies traversal-style debate IDs are rejected in loadDebateSession,
// saveDebateSession, deleteDebateSession, loadDebateComments, saveDebateComments.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => '{"id":"abc-123","title":"T","created_at":"","updated_at":"","phase":"open","transcript":[]}'));
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockStatSync = vi.hoisted(() => vi.fn(() => ({ mtimeMs: 1 })));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mockReadFileProm = vi.fn(async () => '{"id":"x","title":"","created_at":"","updated_at":"","phase":"open","transcript":[]}');
  const mockPromises = { ...actual.promises, readFile: mockReadFileProm };
  const overrides = { existsSync: mockExistsSync, readFileSync: mockReadFileSync, writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync, mkdirSync: mockMkdirSync, statSync: mockStatSync, promises: mockPromises };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('../fileIO.js', () => ({
  resolveDataPath: vi.fn(() => '/fake/debates'),
}));

vi.mock('../../../../lib/debate/calibrationLogger.js', () => ({
  extractCalibrationData: vi.fn(),
  appendCalibrationLog: vi.fn(),
}));

vi.mock('../../../../lib/debate/persistence.js', () => ({
  safeSerialize: vi.fn((v: unknown) => ({ json: JSON.stringify(v), hadError: false })),
  atomicWriteSync: vi.fn(),
  renameSyncWithRetry: vi.fn(),
}));

vi.mock('../../../../lib/debate/errors.js', () => ({
  ActionableError: class ActionableError extends Error {
    constructor(args: { goal: string; problem: string; location: string; nextSteps: string[] }) {
      super(args.problem);
      this.name = 'ActionableError';
    }
  },
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn(() => null),
}));

import {
  loadDebateSession,
  saveDebateSession,
  deleteDebateSession,
  loadDebateComments,
  saveDebateComments,
} from '../debateIO.js';

beforeEach(() => vi.clearAllMocks());

const TRAVERSAL_IDS = ['../../etc/passwd', '../shadow', 'a/b', '/abs/path'];

describe('debateIO — assertSafeId traversal guards', () => {
  it.each(TRAVERSAL_IDS)('loadDebateSession rejects "%s"', async (id) => {
    await expect(loadDebateSession(id)).rejects.toThrow();
  });

  it('loadDebateSession accepts valid id', async () => {
    await expect(loadDebateSession('abc-123')).resolves.toBeDefined();
  });

  it.each(TRAVERSAL_IDS)('saveDebateSession rejects traversal in session.id "%s"', (id) => {
    expect(() => saveDebateSession({ id, transcript: [] }, 'test')).toThrow();
  });

  it('saveDebateSession accepts valid id', () => {
    expect(() => saveDebateSession({ id: 'abc-123', transcript: [] }, 'test')).not.toThrow();
  });

  it.each(TRAVERSAL_IDS)('deleteDebateSession rejects "%s"', (id) => {
    expect(() => deleteDebateSession(id)).toThrow();
  });

  it.each(TRAVERSAL_IDS)('loadDebateComments rejects "%s"', (id) => {
    expect(() => loadDebateComments(id)).toThrow();
  });

  it('loadDebateComments accepts valid id', () => {
    expect(() => loadDebateComments('abc-123')).not.toThrow();
  });

  it.each(TRAVERSAL_IDS)('saveDebateComments rejects "%s"', (id) => {
    expect(() => saveDebateComments(id, {})).toThrow();
  });

  it('saveDebateComments accepts valid id', () => {
    expect(() => saveDebateComments('abc-123', {})).not.toThrow();
  });
});
