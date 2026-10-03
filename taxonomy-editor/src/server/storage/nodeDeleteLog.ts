// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Node-Deletion Audit Log — server-side writer (t/3860; parent design t/3852).
//
// Mirrors `ai/aiCallLog.ts` exactly: O_APPEND single-line JSONL, advisory ID,
// fail-safe non-fatal (an IO error is recorded as WARN and swallowed — audit logging
// must NEVER 500 the delete that triggered it).
//
// Appends to the SAME `node-delete-log.jsonl` the ElectronMain main-process writer
// uses (same getDataRoot() → same physical file), so Get-/Show- tooling reads a
// unified log across both surfaces.
//
// Record schema (9 fields): ID, Datetime, NodeId, Pov, Label, User,
//   DanglingEdges, DanglingSituationRefs, DanglingChildren.
// ID is ADVISORY — no reader joins on it. Atomic single-line append keeps
// concurrent PS/TS writes from interleaving (see aiCallLog.ts for rationale).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataRoot } from '../config.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

const PIPE_BUF = 4096;
const TAIL_READ_BYTES = 8192;

export interface NodeDeleteLogEntry {
  nodeId: string;
  pov: string;
  label: string;
  user: string;
  danglingEdges: number;
  danglingSituationRefs: number;
  danglingChildren: number;
}

export function getNodeDeleteLogPath(): string {
  return path.join(getDataRoot(), 'node-delete-log.jsonl');
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
      message: 'node-delete-log: could not read last-line ID — restarting advisory ID at 1',
      data: { logPath, error: err instanceof Error ? err.message : String(err) },
    });
    return 1;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* silent by design */ } }
  }
}

export function writeNodeDeleteLogEntry(entry: NodeDeleteLogEntry, pathOverride?: string): void {
  const logPath = pathOverride ?? getNodeDeleteLogPath();
  let fd: number | null = null;
  try {
    const dir = path.dirname(logPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });

    const record = {
      ID: nextAdvisoryId(logPath),
      Datetime: new Date().toISOString(),
      NodeId: entry.nodeId,
      Pov: entry.pov,
      Label: entry.label,
      User: entry.user,
      DanglingEdges: entry.danglingEdges,
      DanglingSituationRefs: entry.danglingSituationRefs,
      DanglingChildren: entry.danglingChildren,
    };

    const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
    if (line.length >= PIPE_BUF) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'node-delete-log', level: 'warn',
        message: 'node-delete-log record exceeds PIPE_BUF — atomic-append guarantee not held for this line',
        data: { bytes: line.length, pipeBuf: PIPE_BUF, nodeId: entry.nodeId },
      });
    }
    fd = fs.openSync(logPath, 'a');
    fs.writeSync(fd, line);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'node-delete-log', level: 'warn',
      message: 'node-delete-log append failed — continuing (audit log is non-fatal)',
      data: { logPath, error: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* silent by design */ } }
  }
}
