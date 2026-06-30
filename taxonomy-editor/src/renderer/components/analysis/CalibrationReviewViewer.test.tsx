// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('./CalibrationReviewViewer.css', () => ({}));

const { CalibrationReviewViewer } = await import('./CalibrationReviewViewer');

const DETAIL = {
  domain: 'calibration',
  origin: 'jpsnover',
  source: 'users/jpsnover',
  calibrationLog: {
    coreAverages: { crux_addressed_ratio: 0.7 },
    coreCount: 3859,
    entries: [
      { itemId: 'calibration-log::debate-abc-123', entry: { debate_id: 'debate-abc-123', model: 'gemini-2.0', rounds: 3, crux_addressed_ratio: 0.8 } },
    ],
  },
  extractionMetrics: {
    coreAverages: {},
    coreCount: 0,
    entries: [
      { itemId: 'extraction-metrics::debate-abc-123', entry: { debate_id: 'debate-abc-123', model: 'gemini-2.0', rounds: 3 } },
    ],
  },
  lineageEnrichments: {
    entries: [
      { itemId: 'lineage-enrichments::Governance', key: 'Governance', value: { label: 'Governance', weight: 1 }, coreValue: null },
      { itemId: 'lineage-enrichments::Saftey', key: 'Saftey', value: { label: 'Saftey', weight: 2 }, coreValue: { label: 'Safety', weight: 5 } },
    ],
  },
};

const emptyHeaders = new Headers();

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.startsWith('/api/admin/review/detail/')) {
      return { ok: true, status: 200, headers: emptyHeaders, json: async () => DETAIL } as Response;
    }
    if (url === '/api/admin/review/action') {
      JSON.parse((opts?.body as string) ?? '{}'); // validate JSON body
      return { ok: true, status: 200, headers: emptyHeaders, json: async () => ({ ok: true }) } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastActionBody(fetchMock: ReturnType<typeof mockFetch>) {
  const call = [...fetchMock.mock.calls].reverse().find(c => c[0] === '/api/admin/review/action');
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
}

describe('CalibrationReviewViewer', () => {
  beforeEach(() => { mockFetch(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('loads detail and renders all three kinds', async () => {
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());
    expect(screen.getByText('Calibration Log')).toBeInTheDocument();
    expect(screen.getByText('Extraction Metrics')).toBeInTheDocument();
    expect(screen.getByText('Lineage Enrichments')).toBeInTheDocument();
    // Conflict signal: 'Saftey' (typo) overwrites existing core 'Safety'.
    expect(screen.getByText('overwrites core')).toBeInTheDocument();
    expect(screen.getByText('new to core')).toBeInTheDocument();
  });

  it('fetches detail by encoded groupId', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/review/detail/calibration%3Ajpsnover')).toBe(true);
  });

  it('promotes all items with qualified ids and domain calibration', async () => {
    const fetchMock = mockFetch();
    const onDone = vi.fn();
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" onActionComplete={onDone} />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Promote all'));

    await waitFor(() => {
      const body = lastActionBody(fetchMock);
      expect(body?.domain).toBe('calibration');
      expect(body?.action).toBe('promote');
      expect(body?.itemIds).toEqual([
        'calibration-log::debate-abc-123',
        'extraction-metrics::debate-abc-123',
        'lineage-enrichments::Governance',
        'lineage-enrichments::Saftey',
      ]);
      expect(body?.edits).toBeUndefined();
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('sends an edited lineage value as a patch keyed by qualified itemId', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());

    // Edit the 'Saftey' enrichment to fix the label, then promote all.
    fireEvent.click(screen.getAllByText('Edit')[1]);
    const editor = screen.getByDisplayValue(/"label": "Saftey"/);
    fireEvent.change(editor, { target: { value: JSON.stringify({ label: 'Safety', weight: 2 }, null, 2) } });
    fireEvent.click(screen.getByText('Promote all'));

    await waitFor(() => {
      const body = lastActionBody(fetchMock);
      // Only the changed top-level key is sent in the patch, keyed by the qualified id.
      expect(body?.edits).toEqual({ 'lineage-enrichments::Saftey': { label: 'Safety' } });
    });
    await waitFor(() => expect(screen.getByText(/Promoted 4 items to core \(1 edited\)/)).toBeInTheDocument());
  });

  it('blocks promote when a lineage edit is invalid JSON', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());

    fireEvent.click(screen.getAllByText('Edit')[0]); // Governance
    const editor = screen.getByDisplayValue(/"label": "Governance"/);
    fireEvent.change(editor, { target: { value: '{ not valid json' } });
    fireEvent.click(screen.getByText('Promote all'));

    await waitFor(() => expect(screen.getByText(/Invalid JSON in the edit for "Governance"/)).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/review/action')).toBe(false);
  });

  it('requires a reason before rejecting', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('Reject selected (1)'));

    await waitFor(() => expect(screen.getByText(/Enter a rejection reason first/)).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/review/action')).toBe(false);
  });

  it('rejects selected items with a reason', async () => {
    const fetchMock = mockFetch();
    render(<CalibrationReviewViewer groupId="calibration:jpsnover" />);
    await waitFor(() => expect(screen.getByText('Calibration · jpsnover')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('checkbox')[0]); // calibration-log entry
    fireEvent.change(screen.getByPlaceholderText(/Rejection reason/), { target: { value: 'duplicate' } });
    fireEvent.click(screen.getByText('Reject selected (1)'));

    await waitFor(() => {
      const body = lastActionBody(fetchMock);
      expect(body?.action).toBe('reject');
      expect(body?.itemIds).toEqual(['calibration-log::debate-abc-123']);
      expect(body?.reason).toBe('duplicate');
    });
  });

  it('shows an error when detail fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as Response)));
    render(<CalibrationReviewViewer groupId="calibration:ghost" />);
    await waitFor(() => expect(screen.getByText(/Could not load this review group/)).toBeInTheDocument());
  });
});
