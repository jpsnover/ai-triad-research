// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Mechanical extraction from web-bridge.ts (ADR-007 §2 — cohesive split, no behavior change) to make
// room for t/3624's exportInquiryToFile without exceeding the file's max-lines ceiling (1500, no
// baseline entry). Picked because it's fully self-contained (Blob/anchor + window.print, no
// web-bridge private state) — mirrors ChatExportDropdown's web leg (exportChatToFile) exactly.

import type { InquiryResult } from './types';

export async function exportInquiryToFileWeb(
  result: InquiryResult,
  title: string,
  format: 'json' | 'markdown' | 'pdf',
): Promise<{ cancelled: boolean; filePath?: string }> {
  const { inquiryToJson, inquiryToMarkdown, inquiryToPrintHtml, inquiryExportFilename } = await import('@lib/inquiry/inquiryExport');
  switch (format) {
    case 'pdf': {
      const html = inquiryToPrintHtml(result);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.addEventListener('load', () => printWindow.print());
      }
      return { cancelled: false, filePath: inquiryExportFilename(title, 'pdf') };
    }
    case 'markdown': {
      const content = inquiryToMarkdown(result);
      const filename = inquiryExportFilename(title, 'md');
      const blob = new Blob([content], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      return { cancelled: false, filePath: filename };
    }
    case 'json': {
      const content = inquiryToJson(result);
      const filename = inquiryExportFilename(title, 'json');
      const blob = new Blob([content], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      return { cancelled: false, filePath: filename };
    }
    default: { const _x: never = format; return _x; }
  }
}
