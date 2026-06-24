// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Paired flight-recorder dumps (t/908). A dump is correlated by a client-chosen
 * dumpId across two files in <dataRoot>/admin/flight-recorder-dumps/:
 *   client-{dumpId}.jsonl  — the renderer's ring buffer (uploaded)
 *   server-{dumpId}.jsonl  — this server's ring buffer (admin-only)
 * Both join client↔server events on the shared x-request-id (`requestId`).
 *
 * Retention keeps the last 20 dumpId *pairs* (not files) and enforces a 50 MB
 * cap, deleting whole pairs oldest-first so a client/server half is never
 * orphaned.
 */

import fs from 'fs';
import path from 'path';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

export const MAX_DUMP_GROUPS = 20;
export const MAX_DUMP_BYTES = 50 * 1024 * 1024;

/** dumpIds are client-generated UUIDs; constrain to a safe filename segment. */
export function isValidDumpId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function dumpsDir(dataRoot: string): string {
  return path.join(dataRoot, 'admin', 'flight-recorder-dumps');
}

const DUMP_RE = /^(client|server)-(.+)\.jsonl$/;

export interface DumpFileInfo { name: string; dumpId: string; mtime: number; size: number }

/**
 * Pure retention decision: given the dump files in a dir, return the file names
 * to delete so that at most `maxGroups` dumpId pairs survive and their combined
 * size is ≤ `maxBytes`. Groups are ranked by most-recent mtime; whole groups are
 * dropped oldest-first.
 */
export function selectExpiredDumps(files: DumpFileInfo[], maxGroups = MAX_DUMP_GROUPS, maxBytes = MAX_DUMP_BYTES): string[] {
  const groups = new Map<string, { files: DumpFileInfo[]; mtime: number; size: number }>();
  for (const f of files) {
    const g = groups.get(f.dumpId) ?? { files: [], mtime: 0, size: 0 };
    g.files.push(f);
    g.mtime = Math.max(g.mtime, f.mtime);
    g.size += f.size;
    groups.set(f.dumpId, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.mtime - a.mtime); // newest first
  const toDelete: string[] = [];

  // 1. Drop groups beyond the count cap.
  const kept = ranked.slice(0, maxGroups);
  for (const g of ranked.slice(maxGroups)) toDelete.push(...g.files.map(f => f.name));

  // 2. Enforce the byte cap on the survivors, dropping oldest-first.
  let total = kept.reduce((s, g) => s + g.size, 0);
  for (let i = kept.length - 1; i >= 0 && total > maxBytes; i--) {
    toDelete.push(...kept[i].files.map(f => f.name));
    total -= kept[i].size;
  }
  return toDelete;
}

/** Apply retention to the dump dir (best-effort). */
export function pruneDumps(dir: string): void {
  try {
    const files: DumpFileInfo[] = fs.readdirSync(dir)
      .map(name => ({ name, m: DUMP_RE.exec(name) }))
      .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
      .map(({ name, m }) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, dumpId: m[2], mtime: stat.mtimeMs, size: stat.size };
      });
    for (const name of selectExpiredDumps(files)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* telemetry — silent by design */ }
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'flight-recorder-dumps', level: 'warn',
      message: 'Dump retention sweep failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

/** Write one half of a paired dump and run retention. Returns the file path. */
export function writeDump(dataRoot: string, kind: 'client' | 'server', dumpId: string, ndjson: string): string {
  const dir = dumpsDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${kind}-${dumpId}.jsonl`);
  fs.writeFileSync(filePath, ndjson, 'utf-8');
  pruneDumps(dir);
  return filePath;
}
