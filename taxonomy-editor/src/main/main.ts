// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import http from 'http';
import path from 'path';
import { registerIpcHandlers } from './ipcHandlers';

let mainWindow: BrowserWindow | null = null;
let focusServer: http.Server | null = null;

const FOCUS_PORT = 17862;

function sendFocusNode(nodeId: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('focus-node', nodeId);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

/**
 * Start a tiny HTTP server on localhost that accepts focus-node requests
 * from other apps (e.g. summary-viewer). This is more reliable than
 * single-instance lock across separately-launched Electron dev instances.
 */
function startFocusServer(): void {
  focusServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/focus-node') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const { nodeId } = JSON.parse(body);
          if (nodeId && typeof nodeId === 'string') {
            sendFocusNode(nodeId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'missing nodeId' }));
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  focusServer.listen(FOCUS_PORT, '127.0.0.1', () => {
    console.log(`[main] Focus server listening on http://127.0.0.1:${FOCUS_PORT}`);
  });

  focusServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Another taxonomy-editor instance already owns this port — that's fine.
      console.log('[main] Focus server port already in use, skipping.');
      focusServer = null;
    } else {
      console.error('[main] Focus server error:', err);
    }
  });
}

function registerWindowHandlers(): void {
  ipcMain.handle('grow-window', (_event, deltaWidth: number) => {
    if (!mainWindow) return;
    const [w, h] = mainWindow.getSize();
    mainWindow.setSize(w + deltaWidth, h, true);
  });

  ipcMain.handle('shrink-window', (_event, deltaWidth: number) => {
    if (!mainWindow) return;
    const [w, h] = mainWindow.getSize();
    const newW = Math.max(900, w - deltaWidth);
    mainWindow.setSize(newW, h, true);
  });

  ipcMain.handle('is-maximized', () => {
    if (!mainWindow) return false;
    return mainWindow.isMaximized() || mainWindow.isFullScreen();
  });
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[main] preload path:', preloadPath);
  console.log('[main] app.isPackaged:', app.isPackaged);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Taxonomy Editor',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    console.log('[main] Loading dev URL: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const filePath = path.join(__dirname, '../renderer/index.html');
    console.log('[main] Loading file:', filePath);
    mainWindow.loadFile(filePath);
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh Taxonomy',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('reload-taxonomy');
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
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
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => { if (mainWindow) mainWindow.webContents.zoomLevel += 0.5; },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => { if (mainWindow) mainWindow.webContents.zoomLevel -= 0.5; },
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => { if (mainWindow) mainWindow.webContents.zoomLevel = 0; },
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  registerIpcHandlers();
  registerWindowHandlers();
  startFocusServer();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (focusServer) {
    focusServer.close();
    focusServer = null;
  }
});
