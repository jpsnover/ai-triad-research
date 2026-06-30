// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { resolveDataPath } from './fileIO.js';
import { extractCalibrationData, appendCalibrationLog } from '../../../lib/debate/calibrationLogger.js';
import { safeSerialize, atomicWriteSync } from '../../../lib/debate/persistence.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

const DEBATES_DIR = resolveDataPath('debates');
const INDEX_PATH = path.join(DEBATES_DIR, '.debate-index.json');

export interface DebateSessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: string;
  topic_text?: string;
  model?: string;
  turn_count?: number;
}

interface IndexEntry {
  mtimeMs: number;
  summary: DebateSessionSummary;
}

interface DebateIndex {
  v: 1;
  entries: Record<string, IndexEntry>;
}

function ensureDebatesDir(): void {
  if (!fs.existsSync(DEBATES_DIR)) {
    fs.mkdirSync(DEBATES_DIR, { recursive: true });
  }
}

function debateFilePath(id: string): string {
  return path.join(DEBATES_DIR, `debate-${id}.json`);
}

function loadIndex(): DebateIndex {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1) return parsed;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: 'Debate index missing or corrupt — rebuilding', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
  return { v: 1, entries: {} };
}

function saveIndex(index: DebateIndex): void {
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index), 'utf-8');
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: 'Debate index write failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
}

function extractSummary(data: Record<string, unknown>): DebateSessionSummary {
  const transcript = Array.isArray(data.transcript) ? data.transcript : [];
  const topic = data.topic as { final?: string; original?: string } | undefined;
  return {
    id: data.id as string,
    title: (data.title || data.topic || 'Untitled') as string,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
    phase: data.phase as string,
    topic_text: topic?.final ?? topic?.original ?? '',
    model: data.debate_model as string | undefined,
    turn_count: transcript.filter((t: { type?: string }) => t.type === 'statement' || t.type === 'opening').length,
  };
}

function updateIndexEntry(index: DebateIndex, id: string, session: Record<string, unknown>): void {
  const filename = `debate-${id}.json`;
  const filePath = debateFilePath(id);
  try {
    const stat = fs.statSync(filePath);
    index.entries[filename] = { mtimeMs: stat.mtimeMs, summary: extractSummary(session) };
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: `Stat failed for debate file ${id}`, error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
}

export async function listDebateSessions(): Promise<DebateSessionSummary[]> {
  if (!fs.existsSync(DEBATES_DIR)) return [];

  // Migrate cli-runs files first (rare, sync is fine)
  const cliRunsDir = path.join(DEBATES_DIR, 'cli-runs');
  if (fs.existsSync(cliRunsDir)) {
    const cliFiles = fs.readdirSync(cliRunsDir).filter(f =>
      f.endsWith('.json') && (f.startsWith('debate-') || f.endsWith('-debate.json'))
    );
    for (const f of cliFiles) {
      try {
        const src = path.join(cliRunsDir, f);
        const data = JSON.parse(fs.readFileSync(src, 'utf-8'));
        const dest = path.join(DEBATES_DIR, `debate-${data.id}.json`);
        if (src !== dest) fs.renameSync(src, dest);
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: `Skipping corrupt cli-runs file: ${f}`, error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      }
    }
  }

  const index = loadIndex();
  const nextIndex: DebateIndex = { v: 1, entries: {} };
  const summaries: DebateSessionSummary[] = [];
  let indexDirty = false;

  const files = fs.readdirSync(DEBATES_DIR).filter(f =>
    f.endsWith('.json') && f.startsWith('debate-')
  );

  const readQueue: Array<{ filename: string; filePath: string }> = [];

  for (const f of files) {
    const filePath = path.join(DEBATES_DIR, f);
    try {
      const stat = fs.statSync(filePath);
      const cached = index.entries[f];
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        summaries.push(cached.summary);
        nextIndex.entries[f] = cached;
      } else {
        readQueue.push({ filename: f, filePath });
        indexDirty = true;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: `Stat failed for debate file: ${f}`, error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
  }

  // Removed entries → dirty
  if (Object.keys(index.entries).length !== Object.keys(nextIndex.entries).length + readQueue.length) {
    indexDirty = true;
  }

  // Read changed/new files async (non-blocking)
  const reads = readQueue.map(({ filename, filePath }) =>
    fs.promises.readFile(filePath, 'utf-8').then(raw => {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const summary = extractSummary(data);
      const stat = fs.statSync(filePath);
      nextIndex.entries[filename] = { mtimeMs: stat.mtimeMs, summary };
      summaries.push(summary);
    }).catch((err) => {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debateIO',
        level: 'warn',
        message: `Skipping corrupt debate file: ${filename}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    })
  );
  await Promise.all(reads);

  if (indexDirty) saveIndex(nextIndex);

  summaries.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  return summaries;
}

export async function loadDebateSession(id: string): Promise<unknown> {
  const filePath = debateFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Debate session not found: ${id}`);
  }
  const raw = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function saveDebateSession(session: unknown): void {
  ensureDebatesDir();
  const data = session as { id: string };
  if (!data.id || typeof data.id !== 'string') {
    throw new Error('Cannot save debate session: missing or invalid ID');
  }

  // Embed calibration data for completed debates before saving
  try {
    const s = session as { transcript?: { type: string }[]; calibration_log?: unknown };
    if (s?.transcript?.some(e => e.type === 'concluding') && !s.calibration_log) {
      const dataRoot = path.dirname(DEBATES_DIR);
      const dataPoint = extractCalibrationData(session as Parameters<typeof extractCalibrationData>[0], 'local' as const);
      s.calibration_log = dataPoint;
      appendCalibrationLog(dataPoint, dataRoot);
    }
  } catch { /* telemetry — silent by design;  calibration logging never blocks save */ }

  const filePath = debateFilePath(data.id);
  // Crash-safe persistence (t/1140): safe-serialize (circular/non-serializable fields fall
  // back to a sanitizing replacer and are logged) + atomic temp+rename so a crash mid-write
  // can't leave a truncated session file.
  const { json, hadError, errorMessage } = safeSerialize(session, 2);
  if (hadError) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'debateIO', level: 'warn',
      message: `Debate session ${data.id} saved via sanitizing fallback (non-serializable fields stripped): ${errorMessage}`,
      error: { name: 'SerializationFallback', message: errorMessage ?? 'unknown' },
    });
  }
  atomicWriteSync(filePath, json + '\n');

  // Update metadata index so next list call skips re-reading this file
  try {
    const index = loadIndex();
    updateIndexEntry(index, data.id, session as Record<string, unknown>);
    saveIndex(index);
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: 'Debate index update after save failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
}

export function deleteDebateSession(id: string): void {
  const filePath = debateFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Debate session not found: ${id}`);
  }
  fs.unlinkSync(filePath);

  // Remove from metadata index
  try {
    const index = loadIndex();
    delete index.entries[`debate-${id}.json`];
    saveIndex(index);
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: `Debate index cleanup after delete failed for ${id}`, error: { name: (err as Error).name ?? 'Error', message: String(err) } });
  }
}

// ── Debate comments ────────────────────────────────────────

function commentsFilePath(debateId: string): string {
  return path.join(DEBATES_DIR, `debate-${debateId}-comments.json`);
}

export function loadDebateComments(debateId: string): unknown {
  ensureDebatesDir();
  const filePath = commentsFilePath(debateId);
  if (!fs.existsSync(filePath)) {
    return { _schema_version: '1', debateId, comments: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function saveDebateComments(debateId: string, data: unknown): void {
  ensureDebatesDir();
  const filePath = commentsFilePath(debateId);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
