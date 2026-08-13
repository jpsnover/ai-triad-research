// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { resolveDataPath } from './fileIO.js';
import { assertSafeId } from '../../../lib/electron-shared/safeId.js';
import { atomicWriteSync, renameSyncWithRetry } from '../../../lib/debate/persistence.js';
import { recordLockHolder } from '../../../lib/debate/lockHolder.js';
import { ActionableError } from '../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import type { OpEdSet, OpEdSetSummary } from '../../../lib/oped/types.js';

const OPED_DIR = resolveDataPath('oped-sets');

function ensureOpEdDir(): void {
  if (!fs.existsSync(OPED_DIR)) {
    fs.mkdirSync(OPED_DIR, { recursive: true });
  }
}

function finalPath(setId: string): string {
  assertSafeId(setId, 'oped set id');
  return path.join(OPED_DIR, `oped-${setId}.json`);
}

function wipPath(setId: string): string {
  assertSafeId(setId, 'oped set id');
  return path.join(OPED_DIR, `oped-${setId}-wip.json`);
}

export function saveOpEdSetTemp(set: OpEdSet): void {
  ensureOpEdDir();
  const wip = wipPath(set.set_id);
  const tmp = wip + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(set, null, 2) + '\n', 'utf-8');
  renameSyncWithRetry(tmp, wip);
}

export function finalizeOpEdSet(set: OpEdSet): void {
  ensureOpEdDir();
  const filePath = finalPath(set.set_id);
  const wip = wipPath(set.set_id);
  try {
    atomicWriteSync(filePath, JSON.stringify(set, null, 2) + '\n', recordLockHolder);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'opedIO', level: 'error',
      message: `Op-ed set finalize failed for ${set.set_id}`,
      error: { name: (err as Error).name ?? 'Error', message: String((err as Error).message ?? err), stack: (err as Error).stack },
    });
    throw new ActionableError({
      goal: `Finalize op-ed set ${set.set_id} to ${filePath}`,
      problem: 'Atomic write failed — the target file may be locked by another process.',
      location: 'taxonomy-editor/src/main/opedIO.ts finalizeOpEdSet',
      nextSteps: [
        `The in-progress snapshot is preserved at ${wip}.`,
        'Retry after the file lock clears.',
      ],
      innerError: err,
    });
  }
  if (fs.existsSync(wip)) {
    try { fs.unlinkSync(wip); } catch { /* telemetry — silent by design; wip cleanup is best-effort */ }
  }
  getGlobalRecorder()?.record({
    type: 'state.save', component: 'opedIO', level: 'info',
    message: 'Op-ed set finalized',
    data: { set_id: set.set_id, member_count: set.opeds.length },
  });
}

export function loadOpEdSet(setId: string): OpEdSet {
  const filePath = finalPath(setId);
  if (!fs.existsSync(filePath)) {
    throw new ActionableError({
      goal: `Load op-ed set ${setId}`,
      problem: `Op-ed set file not found at ${filePath}`,
      location: 'taxonomy-editor/src/main/opedIO.ts loadOpEdSet',
      nextSteps: ['Verify the set was created successfully before loading'],
    });
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as OpEdSet;
}

export function deleteOpEdSet(setId: string): void {
  const filePath = finalPath(setId);
  if (!fs.existsSync(filePath)) {
    throw new ActionableError({
      goal: `Delete op-ed set ${setId}`,
      problem: `Op-ed set file not found at ${filePath}`,
      location: 'taxonomy-editor/src/main/opedIO.ts deleteOpEdSet',
      nextSteps: ['Verify the set exists before attempting deletion'],
    });
  }
  fs.unlinkSync(filePath);
}

export function listOpEdSets(): OpEdSetSummary[] {
  ensureOpEdDir();
  const summaries: OpEdSetSummary[] = [];
  for (const entry of fs.readdirSync(OPED_DIR)) {
    if (!entry.startsWith('oped-') || !entry.endsWith('.json') || entry.endsWith('-wip.json')) continue;
    try {
      const set = JSON.parse(fs.readFileSync(path.join(OPED_DIR, entry), 'utf-8')) as OpEdSet;
      summaries.push({
        set_id: set.set_id,
        topic: set.topic,
        created_at: set.created_at,
        camps: set.opeds.map(o => o.pov),
        voice_count: set.opeds.length,
      });
    } catch { /* telemetry — silent by design; skip unreadable/corrupt entries */ }
  }
  return summaries.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function saveOpEdSet(set: OpEdSet): void {
  // Atomic whole-set write (rename edits topic in-place) — mirrors saveDebateSession.
  finalizeOpEdSet(set);
}
