// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Flight-recorder handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Cross-window event forwarding, popup→main dump coordination, dump-to-disk with
// retention, and the standalone viewer launcher. Handler bodies moved verbatim;
// channel names unchanged.

import { app, ipcMain, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../fileIO.js';

export function registerFlightRecorderHandlers(): void {
  // ── Flight recorder: forward events from popup windows to main ──
  ipcMain.on('forward-flight-event', (event, payload: unknown) => {
    // Forward to the main window's renderer (which owns the real recorder)
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender) {
        win.webContents.send('flight-event-from-popup', payload);
      }
    }
  });

  // Forward re-extract-claims request from popout to main window (t/226)
  ipcMain.on('request-re-extract-claims', (event, entryId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender) {
        win.webContents.send('re-extract-claims', entryId);
      }
    }
  });

  // ── Flight recorder: popup requests main window to dump ──
  ipcMain.handle('trigger-main-dump', (event) => {
    return new Promise<{ filePath: string }>((resolve, reject) => {
      // Find the main window (any window that isn't the sender)
      const mainWin = BrowserWindow.getAllWindows().find(w => w.webContents !== event.sender);
      if (!mainWin || mainWin.isDestroyed()) {
        reject(new Error('Main window not available'));
        return;
      }
      // One-time listener for the dump result from the main window
      let timeout: ReturnType<typeof setTimeout>;
      const handler = (_e: Electron.IpcMainEvent, result: { filePath: string }) => {
        clearTimeout(timeout);
        resolve(result);
      };
      timeout = setTimeout(() => {
        ipcMain.removeListener('dump-result', handler);
        reject(new Error('Dump request timed out'));
      }, 10_000);
      ipcMain.once('dump-result', handler);
      mainWin.webContents.send('trigger-dump');
    });
  });

  // ── Flight recorder dump ──
  ipcMain.handle('dump-flight-recorder', (_event, ndjson: string) => {
    const dumpDir = path.join(app.getPath('userData'), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });

    // Filesystem-safe ISO timestamp
    const ts = new Date().toISOString().replace(/:/g, '-');
    const filePath = path.join(dumpDir, `flight-recorder-${ts}.jsonl`);
    fs.writeFileSync(filePath, ndjson, 'utf-8');

    // Retention: keep last 20 files, max 50 MB
    const MAX_FILES = 20;
    const MAX_BYTES = 50 * 1024 * 1024;
    try {
      const files = fs.readdirSync(dumpDir)
        .filter(f => f.startsWith('flight-recorder-') && f.endsWith('.jsonl'))
        .map(f => ({ name: f, path: path.join(dumpDir, f), mtime: fs.statSync(path.join(dumpDir, f)).mtimeMs, size: fs.statSync(path.join(dumpDir, f)).size }))
        .sort((a, b) => b.mtime - a.mtime);  // newest first

      // Delete beyond file count limit
      for (const f of files.slice(MAX_FILES)) {
        fs.unlinkSync(f.path);
      }
      // Delete oldest until within disk budget
      const remaining = files.slice(0, MAX_FILES);
      let totalSize = remaining.reduce((s, f) => s + f.size, 0);
      for (let i = remaining.length - 1; i >= 0 && totalSize > MAX_BYTES; i--) {
        fs.unlinkSync(remaining[i].path);
        totalSize -= remaining[i].size;
      }
    } catch { /* telemetry — silent by design;  retention cleanup is best-effort */ }

    const filename = path.basename(filePath);
    console.log(`[flight-recorder] Dump written: ${filePath}`);
    return { filePath, filename };
  });

  ipcMain.handle('open-flight-recorder-viewer', (_event, dumpPath: string) => {
    if (!fs.existsSync(dumpPath)) return;

    const viewerPath = path.join(PROJECT_ROOT, 'tools', 'flight-recorder-viewer.html');
    if (!fs.existsSync(viewerPath)) {
      // Fallback: open raw file if viewer HTML not found
      void shell.openPath(dumpPath);
      return;
    }

    const dumpContent = fs.readFileSync(dumpPath, 'utf-8');
    const viewerHtml = fs.readFileSync(viewerPath, 'utf-8');

    // Escape for embedding in a JS template literal
    const escaped = dumpContent
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const autoLoadScript = `<script>
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('fileName').textContent = '${path.basename(dumpPath).replace(/'/g, "\\'")}';
  parseNdjson(\`${escaped}\`);
});
</script>`;

    const outputHtml = viewerHtml.replace('</body>', `${autoLoadScript}\n</body>`);

    const tempDir = path.join(app.getPath('temp'), 'flight-recorder-viewer');
    fs.mkdirSync(tempDir, { recursive: true });
    const ts = new Date().toISOString().replace(/:/g, '-');
    const tempFile = path.join(tempDir, `viewer-${ts}.html`);
    fs.writeFileSync(tempFile, outputHtml, 'utf-8');

    void shell.openPath(tempFile);
  });
}
