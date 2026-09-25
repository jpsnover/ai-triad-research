// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the web leg of inquiry export (t/3624) — mirrors exportChatToFile's web-leg
// behavior: Blob+anchor download for json/md, window.open+print() for pdf.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportInquiryToFileWeb } from './inquiryExportWeb';

const SAMPLE_RESULT = {
  schemaVersion: 1,
  request: { question: 'What counts as an AI harm?', fidelity: 'standard' },
  campVerdicts: [],
  convergences: [],
  evidenceLayers: [],
  unresolvedGaps: [],
  calibration: [],
  derivation: { fidelity: 'standard', models: {}, rounds: 4, callBudget: 150 },
  grounding: {},
  singleRunCaveat: 'n=1',
} as unknown as import('./types').InquiryResult;

describe('exportInquiryToFileWeb (t/3624)', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy;
    URL.revokeObjectURL = revokeObjectURLSpy;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);
  });

  it('downloads a JSON blob and returns the filename', async () => {
    const result = await exportInquiryToFileWeb(SAMPLE_RESULT, 'What counts as an AI harm?', 'json');
    expect(result.cancelled).toBe(false);
    expect(result.filePath).toMatch(/\.json$/);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
  });

  it('downloads a Markdown blob and returns the filename', async () => {
    const result = await exportInquiryToFileWeb(SAMPLE_RESULT, 'What counts as an AI harm?', 'markdown');
    expect(result.cancelled).toBe(false);
    expect(result.filePath).toMatch(/\.md$/);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('opens a print window for PDF and returns the filename without touching Blob/anchor', async () => {
    const printSpy = vi.fn();
    const openSpy = vi.fn(() => ({
      document: { write: vi.fn(), close: vi.fn() },
      addEventListener: (_: string, cb: () => void) => cb(),
      print: printSpy,
    } as unknown as Window));
    vi.stubGlobal('open', openSpy);

    const result = await exportInquiryToFileWeb(SAMPLE_RESULT, 'What counts as an AI harm?', 'pdf');
    expect(result.cancelled).toBe(false);
    expect(result.filePath).toMatch(/\.pdf$/);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
