// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import path from 'path';

let ptyProcess: pty.IPty | null = null;

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.resolve(PROJECT_ROOT, '..', 'scripts');

export function registerTerminalHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('terminal:spawn', () => {
    if (ptyProcess) return; // already running

    const shell = '/usr/local/bin/pwsh';
    ptyProcess = pty.spawn(shell, ['-NoLogo'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: PROJECT_ROOT,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    ptyProcess.onData((data: string) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:data', data);
      }
    });

    ptyProcess.onExit(() => {
      ptyProcess = null;
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:exit');
      }
    });

    // Import AITriad module on startup
    const importCmd = `Import-Module '${path.join(SCRIPTS_DIR, 'AITriad', 'AITriad.psd1')}' -Force\r`;
    ptyProcess.write(importCmd);
  });

  ipcMain.handle('terminal:write', (_event, data: string) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.handle('terminal:resize', (_event, cols: number, rows: number) => {
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  });

  ipcMain.handle('terminal:kill', () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
}

export function cleanupTerminal(): void {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
}
