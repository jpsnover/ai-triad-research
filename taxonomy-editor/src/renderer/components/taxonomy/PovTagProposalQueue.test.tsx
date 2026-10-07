// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PovTagProposal, PovTagProposalsFile } from '@lib/schema/povTagProposals';

// t/4052: the queue records decisions through reviewPovTagProposal only, never a node-file save.

const api = vi.hoisted(() => ({
  loadPovTagProposals: vi.fn(),
  reviewPovTagProposal: vi.fn(),
  getChangedFiles: vi.fn(),
  saveTaxonomyFile: vi.fn(),
}));
const mode = vi.hoisted(() => ({ electron: true }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('@bridge', () => ({ api, isElectronMode: () => mode.electron }));
vi.mock('../../hooks/useTaxonomyStore', () => {
  const state = { skeptic: { nodes: [{ id: 'skp-beliefs-001', label: 'Hype outruns evidence', description: 'Claims exceed results.' }] } };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  hook.getState = () => state;
  return { useTaxonomyStore: hook };
});

const { PovTagProposalButton, PovTagProposalQueue } = await import('./PovTagProposalQueue');
const { bundledSkepticSoulProvenance } = await import('./PovTagValueBasis');

const pending: PovTagProposal = { node_id: 'skp-beliefs-001', proposed: ['critical'], status: 'pending', final: null, reviewed_by: null, reviewed_at: null, crux: 'C1', confidence: 0.9, rationale: 'r' };
const file = (p: PovTagProposal = pending): PovTagProposalsFile => ({ version: 1, run: {}, proposals: [p] });

beforeEach(() => {
  vi.clearAllMocks();
  mode.electron = true;
  api.getChangedFiles.mockResolvedValue([]);
});

describe('PovTagProposalButton (t/4052)', () => {
  it('is hidden when the side file is absent, and when the load fails', async () => {
    api.loadPovTagProposals.mockResolvedValueOnce(null);
    const { container, unmount } = render(<PovTagProposalButton pov="skeptic" />);
    await waitFor(() => expect(api.loadPovTagProposals).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    unmount();
    api.loadPovTagProposals.mockRejectedValueOnce(new Error('no handler'));
    const second = render(<PovTagProposalButton pov="skeptic" />);
    await waitFor(() => expect(api.loadPovTagProposals).toHaveBeenCalledTimes(2));
    expect(second.container.firstChild).toBeNull();
  });

  it('shows the pending count for this POV only', async () => {
    api.loadPovTagProposals.mockResolvedValueOnce(file());
    render(<PovTagProposalButton pov="skeptic" />);
    expect(await screen.findByText('Tag proposals (1 pending)')).toBeTruthy();
  });
});

describe('PovTagProposalQueue (t/4052)', () => {
  it('Accept records the decision in the side file only and shows the result', async () => {
    const reviewed = { ...pending, status: 'accepted' as const, final: ['critical'], reviewed_by: 'me', reviewed_at: '2026-10-07' };
    api.reviewPovTagProposal.mockResolvedValueOnce({ file: file(reviewed), item: reviewed });
    render(<PovTagProposalQueue pov="skeptic" initialFile={file()} onClose={() => {}} />);
    expect(screen.getByText('Hype outruns evidence')).toBeTruthy();
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(api.reviewPovTagProposal).toHaveBeenCalledWith('skp-beliefs-001', { status: 'accepted' }, 'pending'));
    // The default filter is "pending", so the reviewed item leaves the list.
    await waitFor(() => expect(screen.queryByText('Hype outruns evidence')).toBeNull());
    expect(api.saveTaxonomyFile).not.toHaveBeenCalled();
  });

  it('on web the list is read-only and says why', () => {
    mode.electron = false;
    render(<PovTagProposalQueue pov="skeptic" initialFile={file()} onClose={() => {}} />);
    expect(screen.getByText(/recorded from the desktop app/)).toBeTruthy();
    expect((screen.getByText('Accept') as HTMLButtonElement).disabled).toBe(true);
    expect(api.getChangedFiles).not.toHaveBeenCalled();
  });

  it('a conflict refreshes from disk and tells the reviewer', async () => {
    api.reviewPovTagProposal.mockResolvedValueOnce({ refused: 'conflict', problems: ['status is accepted'] });
    api.loadPovTagProposals.mockResolvedValueOnce(file());
    render(<PovTagProposalQueue pov="skeptic" initialFile={file()} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Reject'));
    expect(await screen.findByText(/Someone else reviewed this item first/)).toBeTruthy();
    expect(api.loadPovTagProposals).toHaveBeenCalledTimes(1);
  });

  describe('value_basis (t/4052#9, SO e/278#2 condition 4)', () => {
    const vbItem: PovTagProposal = { ...pending, value_basis: [{ tag: 'critical', vh_index: [1], vh_index_uncertain: [], why: 'because', unsupported: false }] };
    const withRun = (soul_provenance?: Record<string, { file: string; hash: string }>): PovTagProposalsFile => ({
      ...file(vbItem),
      value_basis_run: { index_base: 1, value_hierarchies: { critical: ['Cited element — wording'] }, ...(soul_provenance ? { soul_provenance } : {}) },
    });
    const bundled = bundledSkepticSoulProvenance() as Record<string, { file: string; hash: string }>;

    it('shows the justification in place of the crux rationale, and no provenance note when the souls match', () => {
      render(<PovTagProposalQueue pov="skeptic" initialFile={withRun(bundled)} onClose={() => {}} />);
      expect(screen.getByText(/Cited element/)).toBeTruthy();
      expect(screen.queryByText('r')).toBeNull(); // the crux rationale is replaced
      expect(screen.queryByText(/Soul doc changed|Cannot verify/)).toBeNull();
    });

    it('a recorded soul that differs from the bundled one → "soul doc changed since justification"', () => {
      render(<PovTagProposalQueue pov="skeptic" initialFile={withRun({ ...bundled, critical: { file: 'skeptic.critical.soul.json', hash: 'fnv1a64:0000000000000000' } })} onClose={() => {}} />);
      expect(screen.getByText(/Soul doc changed since justification/)).toBeTruthy();
    });

    it('a run with no recorded provenance → "cannot verify", visibly', () => {
      render(<PovTagProposalQueue pov="skeptic" initialFile={withRun()} onClose={() => {}} />);
      expect(screen.getByText(/Cannot verify the soul docs/)).toBeTruthy();
    });

    it('a file with no value_basis run keeps the crux rationale and shows no provenance note', () => {
      render(<PovTagProposalQueue pov="skeptic" initialFile={file()} onClose={() => {}} />);
      expect(screen.getByText('r')).toBeTruthy();
      expect(screen.queryByText(/Model-suggested/)).toBeNull();
    });
  });

  it('shows the uncommitted note when the side file is changed in the data checkout', async () => {
    api.getChangedFiles.mockResolvedValueOnce([{ path: 'taxonomy/Origin/pov-tag-proposals.json', status: 'M' }]);
    render(<PovTagProposalQueue pov="skeptic" initialFile={file()} onClose={() => {}} />);
    expect(await screen.findByText(/not yet committed/)).toBeTruthy();
  });
});
