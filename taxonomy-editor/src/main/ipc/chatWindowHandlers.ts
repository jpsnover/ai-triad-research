// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Chat popout window management (t/2564, t/2780): up to MAX_CHAT_WINDOWS concurrent
// sessions, deduped per chatId (same chatId → focus existing window, no duplicate).
// Each window's chat-stream events target only its own webContents — no cross-stream
// contamination (aiHandlers uses event.sender.send).
//
// Web build: openChatWindow opens a new browser tab on every click; no cap is
// enforced there — the browser handles tab management natively.

import { ipcMain, BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { PROJECT_ROOT } from '../fileIO.js';

export const MAX_CHAT_WINDOWS = 5;

// Module-level registry: chatId → BrowserWindow.
// Exported so tests can reset state between runs.
export const chatWindows = new Map<string, BrowserWindow>();

export function registerChatWindowHandlers(
  preloadPath: string,
  getMainWindow: () => BrowserWindow | null,
  hardenWindow: (win: BrowserWindow) => void,
): void {
  ipcMain.handle('open-chat-window', (_event, chatId: string, source?: 'my' | 'community') => {
    // Prune any windows destroyed without firing 'closed' (defensive).
    for (const [id, win] of chatWindows) {
      if (win.isDestroyed()) chatWindows.delete(id);
    }

    // Per-chat dedup: if a window for this chatId already exists, focus it.
    const existing = chatWindows.get(chatId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }

    if (chatWindows.size >= MAX_CHAT_WINDOWS) {
      // At cap: focus the most-recently-opened chat window (last Map entry).
      const mruWin = [...chatWindows.values()].at(-1)!;
      if (mruWin.isMinimized()) mruWin.restore();
      mruWin.show();
      mruWin.focus();
      return { atCap: true as const };
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

    const hashParams = `chat-window?id=${encodeURIComponent(chatId)}${source ? `&source=${encodeURIComponent(source)}` : ''}`;
    const isDev = !app.isPackaged;
    if (isDev) {
      void win.loadURL(`http://localhost:5173#${hashParams}`);
    } else {
      void win.loadFile(path.join(PROJECT_ROOT, 'taxonomy-editor/dist/renderer/index.html'), { hash: hashParams });
    }

    chatWindows.set(chatId, win);

    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('chat-window-load', chatId);
      }
    });

    win.on('closed', () => {
      chatWindows.delete(chatId);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat-popout-closed', chatId);
      }
    });
  });
}
