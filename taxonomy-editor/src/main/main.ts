// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

console.log('[main] === STARTUP BEGIN ===');
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import fs from 'fs';
import http from 'http';
import path from 'path';
console.log('[main] Core imports OK');
import { registerIpcHandlers } from './ipcHandlers';
console.log('[main] ipcHandlers import OK');
import { registerTerminalHandlers, cleanupTerminal } from './terminal';
console.log('[main] terminal import OK');
import { warmupEmbeddingModel } from './embeddings';
console.log('[main] embeddings import OK');
import { PROJECT_ROOT } from './fileIO';
console.log('[main] fileIO import OK');

let mainWindow: BrowserWindow | null = null;
let diagWindow: BrowserWindow | null = null;
let povProgWindow: BrowserWindow | null = null;
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

  console.log('[main] Creating BrowserWindow...');
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
      webviewTag: true,
    },
  });

  // Use production build if launched with CLI file args (viewer mode) or if packaged
  const hasFileArg = process.argv.some(a => a.startsWith('--diagnostics-file=') || a.startsWith('--harvest-file='));
  const isDev = !app.isPackaged && !hasFileArg;
  if (isDev) {
    console.log('[main] Loading dev URL: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const filePath = path.join(PROJECT_ROOT, 'taxonomy-editor/dist/renderer/index.html');
    console.log('[main] Loading production build:', filePath);
    mainWindow.loadFile(filePath);
  }

  console.log('[main] BrowserWindow created, setting up event handlers...');

  // S6: Restrict webview to HTTPS URLs only — prevent loading arbitrary content
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    // Strip dangerous preferences from webviews
    delete webPreferences.preload;
    (webPreferences as Record<string, unknown>).preloadURL = undefined;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;

    const src = params.src || '';
    if (src && !src.startsWith('https://') && !src.startsWith('http://localhost')) {
      console.warn(`[main] Blocked webview with disallowed src: ${src}`);
      _event.preventDefault();
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] RENDERER CRASHED:', JSON.stringify(details));
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('unresponsive', () => {
    console.error('[main] Window became unresponsive');
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

process.on('uncaughtException', (err) => {
  console.error('[main] UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] UNHANDLED REJECTION:', reason);
});

app.whenReady().then(() => {
  console.log('[main] app.whenReady fired');
  registerIpcHandlers();
  console.log('[main] IPC handlers registered');
  registerTerminalHandlers(() => mainWindow);
  registerWindowHandlers();
  startFocusServer();
  warmupEmbeddingModel();
  console.log('[main] All handlers registered, creating window...');

  // Check for file-viewer command line args
  const diagFileArg = process.argv.find(a => a.startsWith('--diagnostics-file='));
  const harvestFileArg = process.argv.find(a => a.startsWith('--harvest-file='));

  if (diagFileArg) {
    const filePath = diagFileArg.split('=')[1];
    console.log('[main] Opening diagnostics file:', filePath);
    ipcMain.handle('get-cli-file-arg', () => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { type: 'diagnostics', path: filePath, data: JSON.parse(content) };
      } catch (err) {
        console.error('[main] Failed to read diagnostics file:', err);
        return { type: 'diagnostics', path: filePath, data: null, error: String(err) };
      }
    });
  } else if (harvestFileArg) {
    const filePath = harvestFileArg.split('=')[1];
    console.log('[main] Opening harvest file:', filePath);
    ipcMain.handle('get-cli-file-arg', () => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { type: 'harvest', path: filePath, data: JSON.parse(content) };
      } catch (err) {
        console.error('[main] Failed to read harvest file:', err);
        return { type: 'harvest', path: filePath, data: null, error: String(err) };
      }
    });
  } else {
    ipcMain.handle('get-cli-file-arg', () => null);
  }

  createWindow();

  // Diagnostics popout window
  ipcMain.handle('open-diagnostics-window', () => {
    if (diagWindow && !diagWindow.isDestroyed()) {
      diagWindow.focus();
      return;
    }
    const preloadPath = path.join(__dirname, 'preload.js');
    diagWindow = new BrowserWindow({
      width: 700,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      title: 'Debate Diagnostics',
      alwaysOnTop: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const isDev = !app.isPackaged;
    if (isDev) {
      diagWindow.loadURL('http://localhost:5173#diagnostics-window');
    } else {
      diagWindow.loadFile(path.join(PROJECT_ROOT, 'taxonomy-editor/dist/renderer/index.html'), { hash: 'diagnostics-window' });
    }
    diagWindow.on('closed', () => {
      diagWindow = null;
      // Notify main window that popout closed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('diagnostics-popout-closed');
      }
    });
  });

  ipcMain.handle('close-diagnostics-window', () => {
    if (diagWindow && !diagWindow.isDestroyed()) {
      diagWindow.close();
    }
  });

  // Relay diagnostics state from main window to diag window AND pov-progression window
  ipcMain.on('diagnostics-state-update', (_event, state) => {
    if (diagWindow && !diagWindow.isDestroyed()) {
      diagWindow.webContents.send('diagnostics-state-update', state);
    }
    if (povProgWindow && !povProgWindow.isDestroyed()) {
      povProgWindow.webContents.send('diagnostics-state-update', state);
    }
  });

  // POV Progression popout window
  ipcMain.handle('open-pov-progression-window', () => {
    if (povProgWindow && !povProgWindow.isDestroyed()) {
      povProgWindow.focus();
      return;
    }
    const preloadPath = path.join(__dirname, 'preload.js');
    povProgWindow = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 700,
      minHeight: 500,
      title: 'POV Progression',
      alwaysOnTop: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const isDev = !app.isPackaged;
    if (isDev) {
      povProgWindow.loadURL('http://localhost:5173#pov-progression-window');
    } else {
      povProgWindow.loadFile(path.join(PROJECT_ROOT, 'taxonomy-editor/dist/renderer/index.html'), { hash: 'pov-progression-window' });
    }
    povProgWindow.on('closed', () => {
      povProgWindow = null;
    });
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  cleanupTerminal();
  if (focusServer) {
    focusServer.close();
    focusServer = null;
  }
});
