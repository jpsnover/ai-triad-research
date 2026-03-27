// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import http from 'http';
import path from 'path';
import { registerIpcHandlers } from './ipcHandlers';

let mainWindow: BrowserWindow | null = null;

const TAXONOMY_EDITOR_FOCUS_PORT = 17862;

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'SummaryViewer',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5175');
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
      label: 'Settings',
      submenu: [
        {
          label: 'Settings\u2026',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-settings');
            }
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.zoomLevel += 0.5;
            }
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.zoomLevel -= 0.5;
            }
          },
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.zoomLevel = 0;
            }
          },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[SummaryViewer] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerOpenInTaxonomyEditor(): void {
  ipcMain.handle('open-in-taxonomy-editor', (_event, nodeId: string): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const body = JSON.stringify({ nodeId });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TAXONOMY_EDITOR_FOCUS_PORT,
          path: '/focus-node',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 2000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ok: true });
            } else {
              resolve({ ok: false, error: `Taxonomy Editor returned status ${res.statusCode}` });
            }
          });
        },
      );

      req.on('error', () => {
        resolve({ ok: false, error: 'Taxonomy Editor is not running. Please start it first.' });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Taxonomy Editor did not respond in time.' });
      });

      req.write(body);
      req.end();
    });
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  registerOpenInTaxonomyEditor();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
