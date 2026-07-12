// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// t/1541: "External Evidence" section in CruxDetail — reviewer-entered, display-only
// pointers. Editing is gated behind the admin flag; the list is shown to everyone.

const openExternal = vi.fn();
const addCruxEvidence = vi.fn().mockResolvedValue(undefined);
const removeCruxEvidence = vi.fn().mockResolvedValue(undefined);
let flagValue = false;

vi.mock('@bridge', () => ({
  api: { openExternal, addCruxEvidence, removeCruxEvidence },
  isElectronMode: () => false,
}));
vi.mock('../../hooks/useFeatureFlags', () => ({ useFlag: () => flagValue }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCrux(overrides: any = {}) {
  return {
    id: 'crux-001',
    statement: 'Does scaling continue to yield capability gains?',
    type: 'empirical',
    sources: [],
    linked_node_ids: [],
    linked_conflict_ids: [],
    frequency: 1,
    resolution_summary: { resolved: 0, active: 0, irreducible: 0 },
    ...overrides,
  };
}

const { CruxDetail } = await import('./CruxesTab');

describe('CruxDetail — External Evidence (t/1541)', () => {
  beforeEach(() => { flagValue = false; vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders existing evidence read-only for non-admins (no add form, no remove)', () => {
    const crux = makeCrux({
      external_evidence: [{ url: 'https://example.com/study', note: 'Shows plateau', added_by: 'jsnover', added_at: '2026-07-12' }],
    });
    render(<CruxDetail crux={crux} onDebateClick={() => {}} />);

    expect(screen.getByText('External Evidence (1)')).toBeInTheDocument();
    expect(screen.getByText(/example\.com\/study/)).toBeInTheDocument();
    expect(screen.getByText('Shows plateau')).toBeInTheDocument();
    expect(screen.getByText(/jsnover/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Add Evidence')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no evidence and the user cannot edit', () => {
    render(<CruxDetail crux={makeCrux()} onDebateClick={() => {}} />);
    expect(screen.queryByText(/External Evidence/)).not.toBeInTheDocument();
  });

  it('opens evidence URLs via the bridge, not a raw link', () => {
    const crux = makeCrux({ external_evidence: [{ url: 'https://example.com/study', added_by: 'jsnover', added_at: '2026-07-12' }] });
    render(<CruxDetail crux={crux} onDebateClick={() => {}} />);
    fireEvent.click(screen.getByText(/example\.com\/study/));
    expect(openExternal).toHaveBeenCalledWith('https://example.com/study');
  });

  it('shows the add form for admins and gates submit on a valid URL + added_by', () => {
    flagValue = true;
    render(<CruxDetail crux={makeCrux()} onDebateClick={() => {}} />);

    const addBtn = screen.getByRole('button', { name: /add evidence/i });
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'not-a-url' } });
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'jsnover' } });
    expect(addBtn).toBeDisabled(); // invalid protocol

    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'https://arxiv.org/abs/1234' } });
    expect(addBtn).not.toBeDisabled();
  });

  it('adds an entry via the bridge and appends it optimistically', async () => {
    flagValue = true;
    render(<CruxDetail crux={makeCrux()} onDebateClick={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'https://arxiv.org/abs/1234' } });
    fireEvent.change(screen.getByPlaceholderText(/what this shows/i), { target: { value: 'Key result' } });
    fireEvent.change(screen.getByPlaceholderText(/your name/i), { target: { value: 'jsnover' } });
    fireEvent.click(screen.getByRole('button', { name: /add evidence/i }));

    await waitFor(() => expect(addCruxEvidence).toHaveBeenCalledWith('crux-001', {
      url: 'https://arxiv.org/abs/1234', note: 'Key result', added_by: 'jsnover',
    }));
    await waitFor(() => expect(screen.getByText(/arxiv\.org\/abs\/1234/)).toBeInTheDocument());
    expect(screen.getByText('External Evidence (1)')).toBeInTheDocument();
  });

  it('removes an entry via the bridge for admins', async () => {
    flagValue = true;
    const crux = makeCrux({ external_evidence: [{ url: 'https://example.com/a', added_by: 'jsnover', added_at: '2026-07-12' }] });
    render(<CruxDetail crux={crux} onDebateClick={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(removeCruxEvidence).toHaveBeenCalledWith('crux-001', 0));
    await waitFor(() => expect(screen.queryByText(/example\.com\/a/)).not.toBeInTheDocument());
  });
});
