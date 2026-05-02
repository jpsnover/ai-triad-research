// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { ActionableError } from '../../../lib/debate/errors';

export interface PdfExtractionResult {
  fullText: string;
  pageBreaks: number[];
}

export async function extractPdfText(filePath: string): Promise<PdfExtractionResult> {
  if (!fs.existsSync(filePath)) {
    throw new ActionableError({
      goal: 'Extract text from a PDF file',
      problem: `PDF file not found: ${filePath}`,
      location: 'pdfExtractor.ts:extractPdfText',
      nextSteps: [
        'Verify the file path is correct and the file exists on disk',
        'Check that the source was fully ingested (raw/ directory should contain the PDF)',
        'Re-import the source if the file was moved or deleted',
      ],
    });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    throw new ActionableError({
      goal: 'Extract text from a PDF file',
      problem: `Not a PDF file (extension is "${ext}"): ${filePath}`,
      location: 'pdfExtractor.ts:extractPdfText',
      nextSteps: [
        'Provide a file with a .pdf extension',
        'Convert the document to PDF before extraction',
        'Use readSourceFileContent() for .md, .txt, or .docx files',
      ],
    });
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
