// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { app, BrowserWindow, Menu, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { registerIpcHandlers, cleanupIpcHandlers } from './ipcHandlers.js';

/** Apply security hardening to every BrowserWindow (will-navigate + setWindowOpenHandler). */
function hardenWindow(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = ['http://localhost:5174', 'file://'];
    if (!allowed.some(prefix => url.startsWith(prefix))) {
      event.preventDefault();
      console.warn(`[POViewer] Blocked navigation to: ${url}`);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

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
      sandbox: true,
    },
  });
  hardenWindow(mainWindow);

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    const filePath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(filePath);
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Source Licenses',
          click: () => {
            const noticesPath = app.isPackaged
              ? path.join(process.resourcesPath, 'THIRD-PARTY-NOTICES.txt')
              : path.join(__dirname, '../../THIRD-PARTY-NOTICES.txt');
            const licensesWindow = new BrowserWindow({
              width: 800,
              height: 600,
              title: 'Open Source Licenses',
              webPreferences: { sandbox: true },
            });
            hardenWindow(licensesWindow);
            try {
              const content = fs.readFileSync(noticesPath, 'utf-8');
              licensesWindow.loadURL(`data:text/plain;charset=utf-8,${encodeURIComponent(content)}`);
            } catch {
              licensesWindow.loadURL(`data:text/plain;charset=utf-8,${encodeURIComponent('License notices file not found. Run npm run licenses to generate.')}`);
            }
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

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
