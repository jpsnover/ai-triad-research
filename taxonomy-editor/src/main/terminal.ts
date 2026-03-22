// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Uses a Python PTY broker to allocate a real pseudo-terminal.
// Python's pty module works everywhere without native Node bindings.

import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

let brokerProcess: ChildProcess | null = null;

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.resolve(PROJECT_ROOT, '..', 'scripts');
const BROKER_SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'main', 'pty-broker.py');

export function registerTerminalHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('terminal:spawn', () => {
    if (brokerProcess) return;

    const importCmd = `Import-Module '${path.join(SCRIPTS_DIR, 'AITriad', 'AITriad.psd1')}' -Force`;

    brokerProcess = spawn('python3', [BROKER_SCRIPT], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PTY_COLS: '120',
        PTY_ROWS: '30',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    brokerProcess.stdout?.on('data', (data: Buffer) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:data', data.toString());
      }
    });

    brokerProcess.stderr?.on('data', (data: Buffer) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        // Show stderr as terminal output too (for error messages)
        win.webContents.send('terminal:data', data.toString());
      }
    });

    brokerProcess.on('exit', () => {
      brokerProcess = null;
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('terminal:exit');
      }
    });

    // Import AITriad module after a brief delay for shell startup
    setTimeout(() => {
      if (brokerProcess && brokerProcess.stdin) {
        brokerProcess.stdin.write(importCmd + '\r');
      }
    }, 500);
  });

  ipcMain.handle('terminal:write', (_event, data: string) => {
    if (brokerProcess && brokerProcess.stdin) {
      brokerProcess.stdin.write(data);
    }
  });

  ipcMain.handle('terminal:resize', (_event, cols: number, rows: number) => {
    if (brokerProcess && brokerProcess.stdin) {
      // Send resize via custom escape sequence that the broker interprets
      brokerProcess.stdin.write(`\x1b]R;${cols};${rows}\x07`);
    }
  });

  ipcMain.handle('terminal:kill', () => {
    if (brokerProcess) {
      brokerProcess.kill();
      brokerProcess = null;
    }
  });
}

export function cleanupTerminal(): void {
  if (brokerProcess) {
    brokerProcess.kill();
    brokerProcess = null;
  }
}
