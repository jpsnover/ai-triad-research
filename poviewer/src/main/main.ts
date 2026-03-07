// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerIpcHandlers, cleanupIpcHandlers } from './ipcHandlers';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'POViewer',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    const filePath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(filePath);
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[POViewer] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupIpcHandlers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
