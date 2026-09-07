// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the shared run-gate durable telemetry sink (t/3395). The load-bearing property is that
// appendGateTelemetry is BEST-EFFORT: it writes a JSON line on success and returns false (never
// throws) on any failure, so a gate can call it after computing its verdict without the sink ever
// affecting the block/allow decision. Run:
//   node --test operations/devops/gate-telemetry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendGateTelemetry, gateTelemetryDir } from './gate-telemetry.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-telemetry-test-'));
}

test('gateTelemetryDir resolves a .gate-telemetry/ dir next to the module URL', () => {
  // Drive-lettered file URL: fileURLToPath requires an absolute (drive) path on Windows, and a real
  // import.meta.url always has one. POSIX ignores the drive segment harmlessly.
  const dir = gateTelemetryDir(new URL('file:///C:/some/where/operations/devops/x.mjs'));
  assert.ok(
    dir.replace(/\\/g, '/').includes('operations/devops/.gate-telemetry'),
    `expected the .gate-telemetry dir under operations/devops, got: ${dir}`,
  );
});

test('appendGateTelemetry writes one JSON line and creates the dir', () => {
  const base = tmpDir();
  const dir = path.join(base, '.gate-telemetry'); // does not exist yet → must be created
  const ok = appendGateTelemetry({ dir, fileName: 'x.jsonl', record: { a: 1, b: 'two' } });
  assert.equal(ok, true);
  const lines = fs.readFileSync(path.join(dir, 'x.jsonl'), 'utf8').split(/\n/).filter(Boolean);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { a: 1, b: 'two' });
});

test('appendGateTelemetry APPENDS (one line per call, order preserved)', () => {
  const dir = path.join(tmpDir(), '.gate-telemetry');
  appendGateTelemetry({ dir, fileName: 'x.jsonl', record: { n: 1 } });
  appendGateTelemetry({ dir, fileName: 'x.jsonl', record: { n: 2 } });
  const lines = fs.readFileSync(path.join(dir, 'x.jsonl'), 'utf8').split(/\n/).filter(Boolean);
  assert.deepEqual(lines.map((l) => JSON.parse(l).n), [1, 2]);
});

test('appendGateTelemetry returns false and does NOT throw on a bad target (best-effort)', () => {
  // Point at a path whose parent is a FILE, so mkdirSync/appendFileSync must fail — proving the
  // isolation invariant: a broken sink can never surface as an exception into the gate.
  const base = tmpDir();
  const asFile = path.join(base, 'not-a-dir');
  fs.writeFileSync(asFile, 'x');
  const dir = path.join(asFile, 'nested'); // parent is a file → mkdir fails
  let threw = false;
  let result;
  try {
    result = appendGateTelemetry({ dir, fileName: 'x.jsonl', record: { a: 1 } });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result, false);
});

test('appendGateTelemetry returns false on missing dir/fileName (never throws)', () => {
  assert.equal(appendGateTelemetry({ fileName: 'x.jsonl', record: {} }), false);
  assert.equal(appendGateTelemetry({ dir: tmpDir(), record: {} }), false);
  assert.equal(appendGateTelemetry(), false);
});
