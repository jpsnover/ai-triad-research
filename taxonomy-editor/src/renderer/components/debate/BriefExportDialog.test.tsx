// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T7 dialog tests (t/2805): closed-gate, model-provenance mapping (global vs explicit),
// poll→progress→artifacts, and verbatim failure. The T6 API is mocked via @bridge.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { createBriefExport, getBriefExportJob, listBriefExports, downloadBriefArtifact } = vi.hoisted(() => ({
  createBriefExport: vi.fn(), getBriefExportJob: vi.fn(), listBriefExports: vi.fn(), downloadBriefArtifact: vi.fn(),
}));
vi.mock('@bridge', () => ({
  api: { createBriefExport, getBriefExportJob, listBriefExports, downloadBriefArtifact },
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
