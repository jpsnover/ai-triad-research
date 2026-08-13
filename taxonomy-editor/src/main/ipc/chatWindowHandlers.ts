// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Chat popout window management (t/2564): up to MAX_CHAT_WINDOWS concurrent
// independent sessions. Each window's chat-stream events target only its own
// webContents — no cross-stream contamination (aiHandlers uses event.sender.send).
//
// Web build: openChatWindow opens a new browser tab on every click; no cap is
// enforced there — the browser handles tab management natively. This Electron
// cap is intentionally not mirrored in web-bridge.ts.

import { ipcMain, BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { PROJECT_ROOT } from '../fileIO.js';

export const MAX_CHAT_WINDOWS = 5;

// Module-level registry: window id → BrowserWindow.
// Exported so tests can reset state between runs.
export const chatWindows = new Map<number, BrowserWindow>();

export function registerChatWindowHandlers(
  preloadPath: string,
  getMainWindow: () => BrowserWindow | null,
  hardenWindow: (win: BrowserWindow) => void,
): void {
  ipcMain.handle('open-chat-window', () => {
    // Prune any windows destroyed without firing 'closed' (defensive).
    for (const [id, win] of chatWindows) {
      if (win.isDestroyed()) chatWindows.delete(id);
    }

    if (chatWindows.size >= MAX_CHAT_WINDOWS) {
      // At cap: focus the most-recently-opened chat window (last Map entry).
      const mruWin = [...chatWindows.values()].at(-1)!;
      if (mruWin.isMinimized()) mruWin.restore();
      mruWin.show();
      mruWin.focus();
      return;
    }

    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    const offset = chatWindows.size * 30;

    const win = new BrowserWindow({
      width: Math.round(screenW * 0.5),
      height: Math.round(screenH * 0.75),
      x: offset || undefined,
      y: offset || undefined,
      minWidth: 400,
      minHeight: 400,
      title: 'POVer Chat',
      alwaysOnTop: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(win);

    const isDev = !app.isPackaged;
    if (isDev) {
      void win.loadURL('http://localhost:5173#chat-window');
    } else {
      void win.loadFile(path.join(PROJECT_ROOT, 'taxonomy-editor/dist/renderer/index.html'), { hash: 'chat-window' });
    }

    chatWindows.set(win.id, win);

    win.on('closed', () => {
      chatWindows.delete(win.id);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat-popout-closed');
      }
    });
  });
}
