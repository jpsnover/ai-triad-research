// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * t/2022 — `open-flight-recorder-viewer` security. Fixes verified here:
 *  - #5398 (js/incomplete-sanitization): the dump filename is embedded via JSON.stringify +
 *    a '<' escape (complete JS-string encoding that also can't break out of the <script>).
 *  - `</script>` breakout via dump CONTENT is neutralized (all '<' escaped to \u003c).
 *  - dumpPath is confined to the flight-recorder dump dir (renderer-supplied IPC input) — a
 *    path outside it is never read (no arbitrary-file-read primitive).
 *
 * Point PROJECT_ROOT (viewer template) and app.getPath at a temp dir before the module loads;
 * the mocked getPath respects its arg so userData and temp resolve to distinct subdirs.
 */
const H = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const root = `${base}/frv-${process.pid}-${Date.now()}`;
  return { handlers: new Map<string, (...a: unknown[]) => unknown>(), root, opened: [] as string[] };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { H.handlers.set(ch, fn); },
    on: () => {}, once: () => {}, removeListener: () => {},
  },
  app: { getPath: (name: string) => path.join(H.root, name) },
  shell: { openPath: (p: string) => { H.opened.push(p); return Promise.resolve(''); } },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../fileIO.js', () => ({ PROJECT_ROOT: H.root }));

import { registerFlightRecorderHandlers } from '../ipc/flightRecorderHandlers.js';

function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = H.handlers.get(channel);
  if (!fn) throw new Error(`${channel} not registered`);
  return fn({}, ...args);
}

const dumpDir = (): string => path.join(H.root, 'userData', 'flight-recorder');
const viewerOutDir = (): string => path.join(H.root, 'temp', 'flight-recorder-viewer');
const generatedHtml = (): string | null => {
  if (!fs.existsSync(viewerOutDir())) return null;
  const f = fs.readdirSync(viewerOutDir()).find(n => n.endsWith('.html'));
  return f ? fs.readFileSync(path.join(viewerOutDir(), f), 'utf-8') : null;
};

// Write a dump file INTO the confined dump dir (the only legitimate location).
function writeDump(name: string, content: string): string {
  fs.mkdirSync(dumpDir(), { recursive: true });
  const p = path.join(dumpDir(), name);
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  H.handlers.clear();
  H.opened.length = 0;
  fs.rmSync(H.root, { recursive: true, force: true });
  fs.mkdirSync(path.join(H.root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(H.root, 'tools', 'flight-recorder-viewer.html'), '<html><body></body></html>');
  registerFlightRecorderHandlers();
});
afterAll(() => { fs.rmSync(H.root, { recursive: true, force: true }); });

describe('open-flight-recorder-viewer security (t/2022 #5398 + adjacent)', () => {
  it('embeds the dump filename via a fully-escaped JS string literal (JSON.stringify)', () => {
    const dumpName = "weird'name.jsonl";               // apostrophe: legal on every OS
    invoke('open-flight-recorder-viewer', writeDump(dumpName, '{"t":"debate.turn"}\n'));

    const html = generatedHtml();
    expect(html).not.toBeNull();
    // JSON.stringify double-quoted literal, not the old single-quoted (backslash-incomplete) form.
    expect(html).toContain(`textContent = ${JSON.stringify(dumpName)};`);
    expect(html).not.toContain("textContent = '");
    expect(H.opened).toHaveLength(1);
  });

  it('neutralizes a </script> breakout embedded in the dump CONTENT (escapes every <)', () => {
    const evil = '{"m":"</script><script>alert(1)</script>"}\n';
    invoke('open-flight-recorder-viewer', writeDump('evil.jsonl', evil));

    const html = generatedHtml();
    expect(html).not.toBeNull();
    // The injected markup does NOT survive as a real tag — every '<' from the content is \u003c.
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('\\u003c/script>');
  });

  it('confines dumpPath to the dump dir — a path outside it is never read', () => {
    // A traversal/absolute path resolves (via basename) inside the dump dir; the out-of-dir
    // target is never opened as a viewer, so no arbitrary-file-read/embed occurs.
    invoke('open-flight-recorder-viewer', '/etc/passwd');
    expect(generatedHtml()).toBeNull();                 // no viewer HTML generated
    // Whatever was opened (fallback) is confined under the dump dir, never /etc/passwd.
    for (const p of H.opened) expect(p.startsWith(dumpDir())).toBe(true);
  });
});
