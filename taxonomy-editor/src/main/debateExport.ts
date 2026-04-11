// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Electron-specific debate export: PDF via BrowserWindow.printToPDF.
 * Text and Markdown converters are re-exported from the shared library.
 */

import { BrowserWindow } from 'electron';
import {
  debateToHtml,
  type ExportableDebateSession,
} from '../../../lib/debate/debateExport';

// Re-export shared converters so existing imports keep working
export { debateToText, debateToMarkdown, debateToPackage, debateExportFilename } from '../../../lib/debate/debateExport';
export type { ExportableDebateSession, DebateExportFormat } from '../../../lib/debate/debateExport';

export async function debateToPdf(session: ExportableDebateSession): Promise<Buffer> {
  const fullHtml = debateToHtml(session);

  const pdfWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true },
  });

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    pdfWindow.destroy();
  }
}
