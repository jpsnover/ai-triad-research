// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Node-Delete Log — main-process writer (t/3859, Part D of t/3852's design).
//
// Durable local record for taxonomy node deletions: `deletePovNode`/`deleteSituationNode`
// previously left no trace besides the web-only, Electron-no-op `/api/analytics/event` call
// (the t/3852 incident). Appends to `node-delete-log.jsonl` under the resolved data root, with
// the SAME advisory-ID + PIPE_BUF-atomic-append + fail-safe contract as aiCallLog.ts (t/3288) —
// IO errors are WARN-recorded and swallowed, because the audit log must never break the delete
// it's recording.
//
// Unlike aiCallLog.ts's AI_CALL_LOG_ENABLED (default OFF), this log is ALWAYS ON — the whole
// point is a durable record that doesn't depend on anyone remembering to enable it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getDataRootPath } from './fileIO.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

/** Conservative PIPE_BUF floor (Linux = 4096; POSIX minimum = 512). A single write() of a buffer
 *  below this to an O_APPEND fd is atomic, so concurrent appends can't interleave a line. */
const PIPE_BUF = 4096;

/** Bytes read from the file tail to derive the next advisory ID (avoids reading the whole log). */
const TAIL_READ_BYTES = 8192;

export interface NodeDeleteLogEntry {
  nodeId: string;
  pov: string;
  label: string;
  user: string;
  /** Exhaustive counts (not sampled) of what dangles — see renderer/utils/danglingReferences.ts. */
  danglingEdges: number;
  danglingSituationRefs: number;
  danglingChildren: number;
}

/** Absolute path to `node-delete-log.jsonl` under the resolved data root. */
export function getNodeDeleteLogPath(): string {
  return path.join(getDataRootPath(), 'node-delete-log.jsonl');
}

function nextAdvisoryId(logPath: string): number {
  let fd: number | null = null;
  try {
    fd = fs.openSync(logPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size === 0) return 1;
    const readLen = Math.min(size, TAIL_READ_BYTES);
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, size - readLen);
    const lastLine = buf.toString('utf8').trimEnd().split('\n').pop();
    if (!lastLine) return 1;
    const prev = JSON.parse(lastLine) as { ID?: unknown };
    const prevId = typeof prev.ID === 'number' ? prev.ID : Number(prev.ID);
    return Number.isFinite(prevId) ? prevId + 1 : 1;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 1;
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'node-delete-log', level: 'warn',
      message: 'Node-delete log: could not read last-line ID — restarting advisory ID at 1',
      data: { logPath, error: err instanceof Error ? err.message : String(err) },
    });
    return 1;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* silent by design — fd already released */ } }
  }
}

/**
 * Append one record to the node-delete log. Always on (no enable flag — unlike aiCallLog.ts).
 * Fail-safe: IO errors are WARN-recorded and swallowed (the audit log must never break a delete).
 *
 * `user` is supplemented with the OS login when the caller sent '_anonymous' — the renderer's
 * useAuthStatus() is web-only and resolves null on desktop, so the renderer-supplied value is
 * otherwise never a real identity on this host (Rosetta Stone, t/3859#1).
 */
export function writeNodeDeleteLogEntry(entry: NodeDeleteLogEntry, pathOverride?: string): void {
  const logPath = pathOverride ?? getNodeDeleteLogPath();
  let fd: number | null = null;
  try {
    const dir = path.dirname(logPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });

    const user = entry.user === '_anonymous' ? os.userInfo().username : entry.user;

    const record = {
      ID: nextAdvisoryId(logPath),
      Datetime: new Date().toISOString(),
      NodeID: entry.nodeId,
      Pov: entry.pov,
      Label: entry.label,
      User: user,
      DanglingEdges: entry.danglingEdges,
      DanglingSituationRefs: entry.danglingSituationRefs,
      DanglingChildren: entry.danglingChildren,
    };

    const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
    if (line.length >= PIPE_BUF) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'node-delete-log', level: 'warn',
        message: 'Node-delete log record exceeds PIPE_BUF — atomic-append guarantee not held for this line',
        data: { bytes: line.length, pipeBuf: PIPE_BUF, nodeId: entry.nodeId },
      });
    }
    fd = fs.openSync(logPath, 'a');
    fs.writeSync(fd, line); // JSON.stringify escapes newlines (no JSONL injection), path is fixed constant
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'node-delete-log', level: 'warn',
      message: 'Node-delete log append failed — continuing (audit log is non-fatal)',
      data: { logPath, nodeId: entry.nodeId, error: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* silent by design — fd already released */ } }
  }
}
