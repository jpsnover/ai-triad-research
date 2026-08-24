// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T7 dialog tests (t/2805): closed-gate, model-provenance mapping (global vs explicit),
// poll→progress→artifacts, and verbatim failure. The T6 API is mocked via @bridge.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { createBriefExport, getBriefExportJob, listBriefExports, downloadBriefArtifact, printBriefToPdf } = vi.hoisted(() => ({
  createBriefExport: vi.fn(), getBriefExportJob: vi.fn(), listBriefExports: vi.fn(), downloadBriefArtifact: vi.fn(), printBriefToPdf: vi.fn(),
}));
vi.mock('@bridge', () => ({
  api: {
    createBriefExport, getBriefExportJob, listBriefExports, downloadBriefArtifact, printBriefToPdf,
    listBriefTemplates: vi.fn().mockResolvedValue([]),
    uploadBriefTemplate: vi.fn(),
    deleteBriefTemplate: vi.fn(),
  },
  isElectronMode: () => false,
}));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../../hooks/useTaxonomyStore', () => ({
  AI_BACKENDS: [{ value: 'gemini', label: 'Google Gemini' }],
  MODELS_BY_BACKEND: { gemini: [{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }, { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }] },
  useTaxonomyStore: () => ({ geminiModel: 'gemini-2.5-flash' }),
}));

import { BriefExportDialog } from './BriefExportDialog';

const baseProps = { debateId: 'deb-1', debateTitle: 'Should AI pause?', onClose: vi.fn() };

function renderClosed(extra = {}) {
  return render(<BriefExportDialog {...baseProps} debatePhase="closed" {...extra} />);
}

describe('BriefExportDialog (t/2805)', () => {
  beforeEach(() => {
    createBriefExport.mockReset().mockResolvedValue({ jobId: 'job-1' });
    getBriefExportJob.mockReset();
    listBriefExports.mockReset().mockResolvedValue([]);
    downloadBriefArtifact.mockReset();
    printBriefToPdf.mockReset().mockResolvedValue({ cancelled: false });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('open debate: shows the closed-only notice and disables Export', () => {
    render(<BriefExportDialog {...baseProps} debatePhase="open" />);
    expect(screen.getByText(/debates only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(createBriefExport).not.toHaveBeenCalled();
  });

  it('closed + "Use current model": submits model=global provenance', async () => {
    getBriefExportJob.mockResolvedValue({ status: 'narrating', progressPct: 30, warnings: [], error: null, errorCode: null, exportId: null });
    renderClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(createBriefExport).toHaveBeenCalled());
    expect(createBriefExport).toHaveBeenCalledWith('deb-1', expect.objectContaining({
      preset: 'conference', model: 'gemini-2.5-flash', modelSource: 'global',
    }));
  });

  it('closed + explicit model pick: submits model=explicit provenance', async () => {
    getBriefExportJob.mockResolvedValue({ status: 'narrating', progressPct: 30, warnings: [], error: null, errorCode: null, exportId: null });
    renderClosed();
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gemini-2.5-pro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(createBriefExport).toHaveBeenCalled());
    expect(createBriefExport).toHaveBeenCalledWith('deb-1', expect.objectContaining({
      model: 'gemini-2.5-pro', modelSource: 'explicit',
    }));
  });

  it('polls to done and lists downloadable artifacts', async () => {
    vi.useFakeTimers();
    getBriefExportJob.mockResolvedValue({ status: 'done', progressPct: 100, warnings: [], error: null, errorCode: null, exportId: 'exp-1' });
    listBriefExports.mockResolvedValue([{
      exportId: 'exp-1', debateId: 'deb-1', title: 'Should AI pause?', preset: 'conference', status: 'done',
      narratorModel: 'gemini-2.5-flash', narratorModelSource: 'Global', formats: ['pptx'],
      artifacts: ['deck_spec.json', 'narration.json', 'audit-manifest.json', 'brief.pptx'],
      traceCoveragePct: 100, warnings: [], createdAt: '2026-08-19T00:00:00Z',
    }]);
    renderClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await vi.advanceTimersByTimeAsync(1600); // fire the first poll
    await vi.waitFor(() => expect(screen.getByText(/export complete/i)).toBeInTheDocument());
    expect(screen.getByText('Slides (PPTX)')).toBeInTheDocument();
    expect(screen.getByText('Audit manifest (JSON)')).toBeInTheDocument();
  });

  it('poll 404 + persisted failed record: shows the real reason, not "lost track" (t/2888/t/2889)', async () => {
    vi.useFakeTimers();
    getBriefExportJob.mockRejectedValue(new Error('404 not found')); // per-replica registry miss
    listBriefExports.mockResolvedValue([{
      exportId: 'exp-1', debateId: 'deb-1', title: 'Should AI pause?', preset: 'conference',
      status: 'failed', errorCode: 'symmetry_fail',
      reason: 'Export verify gate failed: accelerationist camp produced 0 slides',
      narratorModel: 'gemini-2.5-flash', narratorModelSource: 'Global', formats: [], artifacts: [],
      traceCoveragePct: 0, warnings: [], createdAt: '2026-08-19T00:00:00Z',
    }]);
    renderClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await vi.advanceTimersByTimeAsync(1600); // first poll → 404 → durable-list fallback
    // The fallback must surface the persisted reason, and must NOT show the old "lost track" copy.
    await vi.waitFor(() => expect(screen.getByText(/accelerationist camp produced 0 slides/i)).toBeInTheDocument());
    expect(screen.queryByText(/lost track/i)).not.toBeInTheDocument();
  });

  it('web mode: offers "Save as PDF" when an htmlDoc artifact is present and routes it through the bridge', async () => {
    // Regression (t/2852): the PDF action was gated isElectronMode(), but the brief
    // pipeline runs web-only — so the button was unreachable in both profiles. It must
    // surface in web (where the run happens) whenever the run produced brief.html, and
    // the bridge dispatches print (browser print on web, native printToPDF on Electron).
    vi.useFakeTimers();
    getBriefExportJob.mockResolvedValue({ status: 'done', progressPct: 100, warnings: [], error: null, errorCode: null, exportId: 'exp-1' });
    listBriefExports.mockResolvedValue([{
      exportId: 'exp-1', debateId: 'deb-1', title: 'Should AI pause?', preset: 'conference', status: 'done',
      narratorModel: 'gemini-2.5-flash', narratorModelSource: 'Global', formats: ['pptx'],
      artifacts: ['deck_spec.json', 'narration.json', 'audit-manifest.json', 'brief.pptx', 'brief.html'],
      traceCoveragePct: 100, warnings: [], createdAt: '2026-08-19T00:00:00Z',
    }]);
    downloadBriefArtifact.mockResolvedValue({ text: async () => '<html>brief</html>' });
    renderClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(screen.getByText(/export complete/i)).toBeInTheDocument());

    const pdfBtn = screen.getByRole('button', { name: /save as pdf/i });
    expect(pdfBtn).toBeInTheDocument();
    fireEvent.click(pdfBtn);
    await vi.waitFor(() => expect(printBriefToPdf).toHaveBeenCalledWith('<html>brief</html>'));
    expect(downloadBriefArtifact).toHaveBeenCalledWith('exp-1', 'brief.html');
  });

  it('web mode: no "Save as PDF" when the run produced no htmlDoc artifact', async () => {
    vi.useFakeTimers();
    getBriefExportJob.mockResolvedValue({ status: 'done', progressPct: 100, warnings: [], error: null, errorCode: null, exportId: 'exp-1' });
    listBriefExports.mockResolvedValue([{
      exportId: 'exp-1', debateId: 'deb-1', title: 'Should AI pause?', preset: 'conference', status: 'done',
      narratorModel: 'gemini-2.5-flash', narratorModelSource: 'Global', formats: ['pptx'],
      artifacts: ['deck_spec.json', 'narration.json', 'audit-manifest.json', 'brief.pptx'],
      traceCoveragePct: 100, warnings: [], createdAt: '2026-08-19T00:00:00Z',
    }]);
    renderClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(screen.getByText(/export complete/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /save as pdf/i })).not.toBeInTheDocument();
  });

  it('failed job: shows the gate message verbatim', async () => {
    vi.useFakeTimers();
    getBriefExportJob.mockResolvedValue({ status: 'failed', progressPct: 100, warnings: [], error: 'Export verify gate failed: trace coverage 60% < 80%', errorCode: 'TraceGateFailure', exportId: null });
    renderClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await vi.advanceTimersByTimeAsync(1600);
    await vi.waitFor(() => expect(screen.getByText(/TraceGateFailure/)).toBeInTheDocument());
    expect(screen.getByText(/trace coverage 60% < 80%/)).toBeInTheDocument();
  });
});
