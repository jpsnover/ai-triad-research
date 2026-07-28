// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1824: the debate CLI hung after clean finalization when stdout was piped/redirected on win32.
// main() writes every artifact, but the flight-recorder named-pipe listener it started
// (recorder.startPipeListener — a live net.Server) was released ONLY on SIGINT, so a signal-free
// batch run rode its watchdog to an external kill and never produced exit code 0. The fix releases
// the listener on the clean path (cli.ts bottom wrapper `.then(stopPipeListener)`).
//
// This spawns the repro harness (cliPipeExit.fixture.ts), which mirrors that lifecycle: start the
// listener, emit the final result line, then reach end-of-program — releasing the listener only
// under `--fix`. It proves the mechanism the CLI fix depends on: an open listener pins the event
// loop (process hangs); releasing it lets the loop drain (process exits 0). Cross-platform: on
// non-win32 the pipe path binds a unix socket, same live-handle behavior; the hang case is gated to
// win32 (where the bug lives and a killed child leaves no socket file to clean up).

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixture = path.join(here, 'cliPipeExit.fixture.ts');

// Run the harness via `node --import tsx <fixture> [--fix]`. cwd = repoRoot so `tsx` resolves from
// the root node_modules. Returns the spawnSync result (status/signal/stdout).
function runHarness(fix: boolean, timeoutMs: number): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', fixture, ...(fix ? ['--fix'] : [])],
    { cwd: repoRoot, timeout: timeoutMs, encoding: 'utf8' },
  );
}

describe('debate CLI clean-exit lifecycle (t/1824)', () => {
  it('WITH the fix (stopPipeListener): the loop drains → process exits 0 within seconds', () => {
    const r = runHarness(true, 20000);
    expect(r.stdout).toContain('finalized'); // reached finalization
    expect(r.signal).toBeNull();             // not killed
    expect(r.status).toBe(0);                // clean exit code — batch harnesses can trust returncode
  }, 30000);

  it.runIf(process.platform === 'win32')(
    'WITHOUT the fix: the open pipe listener pins the loop → process never exits on its own',
    () => {
      const r = runHarness(false, 5000);
      expect(r.stdout).toContain('finalized'); // it DID finalize before hanging
      expect(r.status).not.toBe(0);            // never exited cleanly (killed by the 5s timeout)
    },
    15000,
  );
});
