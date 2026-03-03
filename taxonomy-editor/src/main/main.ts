import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipcHandlers';

let mainWindow: BrowserWindow | null = null;

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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
