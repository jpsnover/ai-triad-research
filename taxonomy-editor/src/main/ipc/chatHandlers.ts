// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Chat handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Chat session persistence + chat export (md/txt/pdf). Handler bodies moved
// verbatim; channel names unchanged.

import { ipcMain, BrowserWindow, dialog } from 'electron';
import {
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
} from '../chatIO.js';
import { chatToMarkdown, chatToText, chatToPrintHtml, chatExportFilename, type ChatExportEntry, type ChatExportOptions } from '../../../../lib/chat/chatExportFormatters.js';

export function registerChatHandlers(): void {
  ipcMain.handle('list-chat-sessions', () => {
    return listChatSessions();
  });

  ipcMain.handle('load-chat-session', (_event, id: string) => {
    return loadChatSession(id);
  });

  ipcMain.handle('save-chat-session', (_event, session: unknown) => {
    saveChatSession(session);
  });

  ipcMain.handle('delete-chat-session', (_event, id: string) => {
    deleteChatSession(id);
  });

  // Chat export (t/1485) — mirrors export-debate-to-file. Formatters live in lib/chat
  // (main-safe, like lib/debate); PDF is print-to-PDF via an offscreen window like debateToPdf.
  ipcMain.handle('export-chat-to-file', async (event, entries: ChatExportEntry[], format: 'markdown' | 'text' | 'pdf', options: ChatExportOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { cancelled: true };

    // Map requested format to a default extension and put it first in the filter list.
    const formatExtMap: Record<string, string> = { markdown: 'md', text: 'txt', pdf: 'pdf' };
    const defaultExt = formatExtMap[format] || 'md';
    const allFilters = [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Plain Text', extensions: ['txt'] },
      { name: 'PDF', extensions: ['pdf'] },
    ];
    const selectedIdx = allFilters.findIndex(f => f.extensions[0] === defaultExt);
    const filters = selectedIdx > 0
      ? [allFilters[selectedIdx], ...allFilters.filter((_, i) => i !== selectedIdx)]
      : allFilters;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Chat',
      defaultPath: chatExportFilename(options.title, defaultExt),
      filters,
    });

    if (result.canceled || !result.filePath) {
      return { cancelled: true };
    }

    const fs = await import('fs');
    const filePath = result.filePath;
    const ext = filePath.split('.').pop()?.toLowerCase() || defaultExt;

    switch (ext) {
      case 'txt': {
        fs.writeFileSync(filePath, chatToText(entries, options), 'utf-8');
        break;
      }
      case 'pdf': {
        // Print-to-PDF via an offscreen window, mirroring debateToPdf.
        const pdfWindow = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
        try {
          const html = chatToPrintHtml(entries, options);
          await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const pdfBuffer = await pdfWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          pdfWindow.destroy();
        }
        break;
      }
      case 'md':
      default: {
        fs.writeFileSync(filePath, chatToMarkdown(entries, options), 'utf-8');
        break;
      }
    }

    return { cancelled: false, filePath };
  });
}
