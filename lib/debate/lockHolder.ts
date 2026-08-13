// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// Node-only module — NOT reachable from the renderer bundle.
// Imported only by main-process / CLI callers (cli.ts, server).
// Do NOT import this from any module in comments.ts's import graph.

import { execFileSync } from 'child_process';
import { getGlobalRecorder } from '../flight-recorder/index.js';

type LockHolderInfo = {
  processName?: string;
  pid?: number;
  unavailable?: boolean;
  reason?: string;
};

// t/2544: identify the process holding a file lock (Windows only, handle.exe).
// Uses execFileSync argv form — no shell interpolation (t/2549 CodeQL #5530).
function queryLockHolder(filePath: string): LockHolderInfo {
  if (process.platform !== 'win32') return { unavailable: true, reason: 'non-Windows' };
  try {
    const output = execFileSync('handle.exe', [filePath], { timeout: 2000, encoding: 'utf-8' });
    // handle.exe output: "<ProcessName>  pid: <pid>  type: File  <handle>: <path>"
    const match = output.match(/^(\S+)\s+pid:\s+(\d+)\s/m);
    if (match) return { processName: match[1], pid: parseInt(match[2], 10) };
    return { unavailable: true, reason: 'handle.exe output not parseable' };
  } catch {
    return { unavailable: true, reason: 'handle.exe not on PATH or timed out' };
  }
}

/**
 * Query the lock holder for filePath and emit an io.lock-holder FR event.
 * Pass as the onLockExhausted callback to atomicWriteSync / renameSyncWithRetry.
 */
export function recordLockHolder(filePath: string): void {
  const lockHolder = queryLockHolder(filePath);
  getGlobalRecorder()?.record({
    type: 'io.lock-holder', component: 'persistence', level: 'warn',
    message: lockHolder.unavailable
      ? `io.lock-holder: unavailable (${lockHolder.reason})`
      : `io.lock-holder: ${lockHolder.processName} pid ${lockHolder.pid}`,
    data: { filePath, ...lockHolder },
  });
}
