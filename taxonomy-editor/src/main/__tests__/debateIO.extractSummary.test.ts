// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Regression test for t/2334: extractSummary() fell back to `data.topic` (object)
 * when `data.title` was falsy, making SessionRowData.title an object and crashing
 * DebateTableRow with "Objects are not valid as a React child".
 *
 * Tests drive listDebateSessions() against a real temp-dir debates folder so the
 * fix is exercised through the same code path that the crash hit.
 */

const h = vi.hoisted(() => ({ debatesRoot: '' }));

vi.mock('../fileIO.js', () => ({
  resolveDataPath: (sub: string) => {
    if (!h.debatesRoot) {
      h.debatesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'debateio-extract-'));
    }
    return path.join(h.debatesRoot, sub);
  },
}));

vi.mock('../../../../lib/debate/calibrationLogger.js', () => ({
  extractCalibrationData: () => null,
  appendCalibrationLog: () => undefined,
}));

// Imported AFTER mocks so debateIO binds the mocked deps.
import { listDebateSessions } from '../debateIO.js';

function writeDebate(dir: string, id: string, data: Record<string, unknown>): void {
  const debatesDir = path.join(dir, 'debates');
  fs.mkdirSync(debatesDir, { recursive: true });
  fs.writeFileSync(path.join(debatesDir, `debate-${id}.json`), JSON.stringify(data), 'utf-8');
}

afterAll(() => {
  if (h.debatesRoot) fs.rmSync(h.debatesRoot, { recursive: true, force: true });
});

describe('extractSummary title fallback (t/2334)', () => {
  it('returns topic.final as title when title is absent and topic is a structured object', async () => {
    writeDebate(h.debatesRoot, 'a1', {
      id: 'a1',
      created_at: '2026-08-08T10:00:00Z',
      updated_at: '2026-08-08T10:00:00Z',
      phase: 'synthesis',
      topic: { final: 'Climate AI', original: 'AI climate policy' },
      transcript: [],
    });

    const sessions = await listDebateSessions();
    const s = sessions.find(x => x.id === 'a1');
    expect(s).toBeDefined();
    expect(typeof s!.title).toBe('string');
    expect(s!.title).toBe('Climate AI');
  });

  it('falls back to topic.original when topic.final is absent', async () => {
    writeDebate(h.debatesRoot, 'a2', {
      id: 'a2',
      created_at: '2026-08-08T10:00:00Z',
      updated_at: '2026-08-08T10:00:00Z',
      phase: 'opening',
      topic: { original: 'Fallback topic' },
      transcript: [],
    });

    const sessions = await listDebateSessions();
    const s = sessions.find(x => x.id === 'a2');
    expect(s).toBeDefined();
    expect(typeof s!.title).toBe('string');
    expect(s!.title).toBe('Fallback topic');
  });

  it('falls back to "Untitled" when title, topic.final, and topic.original are all absent', async () => {
    writeDebate(h.debatesRoot, 'a3', {
      id: 'a3',
      created_at: '2026-08-08T10:00:00Z',
      updated_at: '2026-08-08T10:00:00Z',
      phase: 'opening',
      topic: {},
      transcript: [],
    });

    const sessions = await listDebateSessions();
    const s = sessions.find(x => x.id === 'a3');
    expect(s).toBeDefined();
    expect(s!.title).toBe('Untitled');
  });

  it('uses the explicit title when present, ignoring topic', async () => {
    writeDebate(h.debatesRoot, 'a4', {
      id: 'a4',
      title: 'My explicit title',
      created_at: '2026-08-08T10:00:00Z',
      updated_at: '2026-08-08T10:00:00Z',
      phase: 'concluding',
      topic: { final: 'Should not appear' },
      transcript: [],
    });

    const sessions = await listDebateSessions();
    const s = sessions.find(x => x.id === 'a4');
    expect(s).toBeDefined();
    expect(s!.title).toBe('My explicit title');
  });
});
