// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Uses node-pty for a real pseudo-terminal on Windows (ConPTY) and Unix (PTY).
// Lazy-imports node-pty to avoid conpty_console_list_agent crash at startup.

import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { PROJECT_ROOT } from './fileIO';

type IPty = import('node-pty').IPty;

let ptyProcess: IPty | null = null;

const SCRIPTS_DIR = path.resolve(PROJECT_ROOT, 'scripts');

function findShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC?.toLowerCase().includes('pwsh')
      ? process.env.COMSPEC
      : 'pwsh.exe';
  }
  return process.env.SHELL_PWSH || 'pwsh';
}

export function registerTerminalHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('terminal:spawn', async () => {
    if (ptyProcess) return;

    const shell = findShell();
    const importCmd = `Import-Module '${path.join(SCRIPTS_DIR, 'AITriad', 'AITriad.psd1')}' -Force`;

    let pty: typeof import('node-pty');
    try {
      pty = await import('node-pty');
    } catch (err) {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        const msg = err instanceof Error ? err.message : String(err);
        win.webContents.send(
          'terminal:data',
          `Failed to load node-pty: ${msg}\r\n` +
          'The integrated terminal requires native node-pty support.\r\n',
        );
        win.webContents.send('terminal:exit');
      }
      return;
    }

    try {
      ptyProcess = pty.spawn(shell, ['-NoLogo'], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: PROJECT_ROOT,
        env: { ...process.env, __PSLockdownPolicy: '4' } as { [key: string]: string },
      });
    } catch (err) {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        const msg = err instanceof Error ? err.message : String(err);
        win.webContents.send(
          'terminal:data',
          `Failed to start shell '${shell}': ${msg}\r\n` +
          'Install PowerShell 7+ from https://github.com/PowerShell/PowerShell and restart Taxonomy Editor.\r\n',
        );
        win.webContents.send('terminal:exit');
      }
      return;
    }

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

    // Import AITriad module, then lock down to ConstrainedLanguage mode
    setTimeout(() => {
      if (ptyProcess) {
        ptyProcess.write(importCmd + '\r');
        ptyProcess.write('$ExecutionContext.SessionState.LanguageMode = "ConstrainedLanguage"\r');
      }
    }, 500);
  });

  ipcMain.handle('terminal:write', (_event, data: string) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.handle('terminal:resize', (_event, cols: number, rows: number) => {
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch { /* ignore races during shutdown */ }
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
