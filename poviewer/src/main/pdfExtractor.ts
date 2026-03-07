// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

export interface PdfExtractionResult {
  fullText: string;
  pageBreaks: number[];
}

export async function extractPdfText(filePath: string): Promise<PdfExtractionResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    throw new Error(`Not a PDF file: ${filePath}`);
  }

  // Dynamic import pdfjs-dist for Node.js usage
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  let fullText = '';
  const pageBreaks: number[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .filter((item: Record<string, unknown>) => 'str' in item)
      .map((item: Record<string, unknown>) => item.str as string)
      .join(' ');

    if (i > 1) {
      pageBreaks.push(fullText.length);
      fullText += '\n\n';
    }
    fullText += pageText;
  }

  return { fullText, pageBreaks };
}
