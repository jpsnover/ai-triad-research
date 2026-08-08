// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { resolveDataPath } from './fileIO.js';
import { extractCalibrationData, appendCalibrationLog } from '../../../lib/debate/calibrationLogger.js';
import { safeSerialize, atomicWriteSync, renameSyncWithRetry } from '../../../lib/debate/persistence.js';
import { ActionableError } from '../../../lib/debate/errors.js';
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
    title: (data.title as string) || topic?.final || topic?.original || 'Untitled',
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

/** One-time migration: move any legacy cli-runs/*.json debate files up into DEBATES_DIR.
 *  Rare + sync. Extracted verbatim from listDebateSessions (t/1914 complexity split). */
function migrateCliRunsFiles(): void {
  const cliRunsDir = path.join(DEBATES_DIR, 'cli-runs');
  if (!fs.existsSync(cliRunsDir)) return;
  const cliFiles = fs.readdirSync(cliRunsDir).filter(f =>
    f.endsWith('.json') && (f.startsWith('debate-') || f.endsWith('-debate.json'))
  );
  for (const f of cliFiles) {
    try {
      const src = path.join(cliRunsDir, f);
      const data = JSON.parse(fs.readFileSync(src, 'utf-8'));
      const dest = path.join(DEBATES_DIR, `debate-${data.id}.json`);
      if (src !== dest) renameSyncWithRetry(src, dest);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debateIO', level: 'warn', message: `Skipping corrupt cli-runs file: ${f}`, error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }
  }
}

/** Compute the debate-specific loss context (run_id, turn_count, preserved .tmp path) for
 *  an enriched save-failure error (t/1638). Extracted from saveDebateSession (t/1914); the
 *  record() + throw stay IN the catch so ADR-003's AST rule sees the recording site. */
function computeSaveLossContext(session: unknown, filePath: string): { runId: string; turnCount: number; tmpPath: string } {
  const tmpPath = `${filePath}.tmp`;
  const runId = (session as { run_id?: string }).run_id ?? 'unknown';
  const transcript = Array.isArray((session as { transcript?: unknown }).transcript)
    ? ((session as { transcript: { type?: string }[] }).transcript)
    : [];
  const turnCount = transcript.filter(t => t.type === 'statement' || t.type === 'opening').length;
  return { runId, turnCount, tmpPath };
}

export async function listDebateSessions(): Promise<DebateSessionSummary[]> {
  if (!fs.existsSync(DEBATES_DIR)) return [];

  // Migrate legacy cli-runs files first (rare, sync is fine).
  migrateCliRunsFiles();

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

/** For a completed debate (has a concluding turn) that lacks a calibration_log, extract +
 *  append the calibration data point. Never blocks the save. Extracted from
 *  saveDebateSession (t/1914). */
function embedCalibrationIfCompleted(session: unknown): void {
  try {
    const s = session as { transcript?: { type: string }[]; calibration_log?: unknown };
    if (s?.transcript?.some(e => e.type === 'concluding') && !s.calibration_log) {
      const dataRoot = path.dirname(DEBATES_DIR);
      const dataPoint = extractCalibrationData(session as Parameters<typeof extractCalibrationData>[0], 'local' as const);
      s.calibration_log = dataPoint;
      appendCalibrationLog(dataPoint, dataRoot);
    }
  } catch { /* telemetry — silent by design;  calibration logging never blocks save */ }
}

export function saveDebateSession(session: unknown): void {
  ensureDebatesDir();
  const data = session as { id: string };
  if (!data.id || typeof data.id !== 'string') {
    throw new Error('Cannot save debate session: missing or invalid ID');
  }

  // Embed calibration data for completed debates before saving (best-effort).
  embedCalibrationIfCompleted(session);

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
  try {
    atomicWriteSync(filePath, json + '\n');
  } catch (err) {
    // t/1638: atomicWriteSync (t/1627) throws on a total-loss save naming only
    // filePath/tmpPath; re-throw enriched with the debate-specific state (id, run_id,
    // turn_count + preserved .tmp). record() + throw stay here (ADR-003 in-catch rule).
    const { runId, turnCount, tmpPath } = computeSaveLossContext(session, filePath);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'debateIO', level: 'error',
      message: `Debate save failed for ${data.id} (run ${runId}, ${turnCount} turns) — payload preserved at ${tmpPath}`,
      data: { debateId: data.id, runId, turnCount, tmpPath },
      error: { name: (err as Error).name ?? 'Error', message: String((err as Error).message ?? err), stack: (err as Error).stack },
    });
    throw new ActionableError({
      goal: `Save debate ${data.id} (run ${runId}, ${turnCount} turns) to ${filePath}`,
      problem: `The atomic write to ${filePath} failed after exhausting the rename-retry budget and the in-place copy fallback — the target is held by another process (Windows antivirus/indexer). Debate ${data.id}, run ${runId}: ${turnCount} turns are at risk of being lost.`,
      location: 'taxonomy-editor/src/main/debateIO.ts saveDebateSession',
      nextSteps: [
        `The full session snapshot for debate ${data.id} (run ${runId}, ${turnCount} turns) is preserved at ${tmpPath} and was NOT deleted — it is the only durable copy. Do not remove it.`,
        `Retry the save once the file lock clears; the next successful save re-persists all ${turnCount} turns and replaces ${filePath}, after which ${tmpPath} may be removed.`,
        `If saves keep failing, exclude the debates directory from antivirus/search-indexer scanning.`,
      ],
      innerError: err,
    });
  }

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
  renameSyncWithRetry(tmpPath, filePath);
}
