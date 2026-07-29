// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1884 §7 — EntityBrowserPanel lists entity summaries from api.listEntities, filters
// and sorts client-side, and opens the shared DetailPane on row selection. DetailPane is
// stubbed so this suite tests the LIST/selection behavior, not the detail renderer (t/1882).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntitySummary } from '@lib/entities/types';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('@bridge', () => ({ api: { listEntities: vi.fn() } }));
// Stub the shared DetailPane — surface only the selected ref id so we can assert selection.
vi.mock('./DetailPane', () => ({
  DetailPane: (p: { selectedRef?: { id: string } | null; onClose?: () => void }) => (
    <div data-testid="detail-pane" data-ref={p.selectedRef?.id}>
      <button onClick={p.onClose}>close</button>
    </div>
  ),
}));

import { api } from '@bridge';
import { EntityBrowserPanel } from './EntityBrowserPanel';

const ENTITIES: EntitySummary[] = [
  { id: 'ent-001', name: 'OpenAI', aliases: ['OpenAI Inc.'], entity_type: 'institution', status: 'approved', confidence: 0.9, last_modified: '2026-02-01' },
  { id: 'ent-002', name: 'EU AI Act', aliases: [], entity_type: 'legislation', status: 'proposed', confidence: 0.7, last_modified: '2026-03-01' },
  { id: 'ent-003', name: 'p(doom)', aliases: ['p-doom'], entity_type: 'artifact', status: 'deprecated', confidence: 0.5, last_modified: '2026-01-01' },
];

const listEntitiesMock = api.listEntities as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  listEntitiesMock.mockReset();
  listEntitiesMock.mockResolvedValue(ENTITIES);
});

// Scope to the listbox — a bare getAllByRole('option') would also match the sort
// <select>'s native <option> elements.
function options() {
  const lb = screen.queryByRole('listbox');
  return lb ? within(lb).queryAllByRole('option') : [];
}

describe('EntityBrowserPanel', () => {
  it('does not crash when an entity has aliases:null (real-data defect, t/1884#3)', async () => {
    // ~40% of real entities carry aliases:null despite the string[] type. Exercises the
    // row [0] read AND the search .some() path — both must survive null.
    listEntitiesMock.mockResolvedValue([
      { id: 'ent-034', name: 'Claude', aliases: null as unknown as string[], entity_type: 'artifact', status: 'approved', confidence: 0.9, last_modified: '2026-02-01' },
    ]);
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    expect(await screen.findByText('Claude')).toBeInTheDocument();
    expect(options()).toHaveLength(1);
    await user.type(screen.getByLabelText('Search entities'), 'anything'); // .some over null must not throw
    expect(screen.getByText('No entities match')).toBeInTheDocument();
  });

  it('lists all entities and shows the total count', async () => {
    render(<EntityBrowserPanel />);
    expect(await screen.findByText('OpenAI')).toBeInTheDocument();
    expect(options()).toHaveLength(3);
    expect(screen.getByText('3 entities')).toBeInTheDocument();
  });

  it('renders no raw entity IDs in the rows (AC #4)', async () => {
    render(<EntityBrowserPanel />);
    const list = await screen.findByRole('listbox');
    expect(list.textContent).not.toMatch(/ent-00\d/);
  });

  it('filters by search and updates the count to "N of M"', async () => {
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    await screen.findByText('OpenAI');
    await user.type(screen.getByLabelText('Search entities'), 'openai');
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('filters by a type facet chip', async () => {
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    await screen.findByText('OpenAI');
    await user.click(screen.getByRole('button', { name: /legislation/i }));
    await waitFor(() => expect(options()).toHaveLength(1));
    expect(screen.getByText('EU AI Act')).toBeInTheDocument();
  });

  it('opens the shared DetailPane with the entity ref on row click and marks the row selected', async () => {
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    await user.click(await screen.findByText('OpenAI'));
    const pane = await screen.findByTestId('detail-pane');
    expect(pane).toHaveAttribute('data-ref', 'ent-001');
    const row = screen.getByText('OpenAI').closest('[role="option"]');
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('de-emphasizes deprecated rows', async () => {
    render(<EntityBrowserPanel />);
    await screen.findByText('p(doom)');
    const row = screen.getByText('p(doom)').closest('[role="option"]');
    expect(row?.className).toContain('ebp-row-deprecated');
  });

  it('is a keyboard-navigable listbox: ArrowDown + Enter opens the active row', async () => {
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    await screen.findByText('OpenAI');
    const list = screen.getByRole('listbox');
    list.focus();
    // Default sort is Name A–Z → [EU AI Act, OpenAI, p(doom)]. ArrowDown moves the active
    // descendant from row 0 to row 1 (OpenAI, ent-001); Enter opens it.
    await user.keyboard('{ArrowDown}{Enter}');
    const pane = await screen.findByTestId('detail-pane');
    expect(pane).toHaveAttribute('data-ref', 'ent-001');
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    await screen.findByText('OpenAI');
    await user.type(screen.getByLabelText('Search entities'), 'zzzznomatch');
    expect(await screen.findByText('No entities match')).toBeInTheDocument();
    expect(options()).toHaveLength(0);
  });

  it('shows an error state when the bridge rejects', async () => {
    listEntitiesMock.mockRejectedValue(new Error('desktop transport not wired'));
    render(<EntityBrowserPanel />);
    expect(await screen.findByText('Couldn’t load entities')).toBeInTheDocument();
  });

  it('sorts by the selected key (Confidence desc)', async () => {
    const user = userEvent.setup();
    render(<EntityBrowserPanel />);
    await screen.findByText('OpenAI');
    await user.selectOptions(screen.getByLabelText('Sort entities'), 'confidence');
    const names = options().map(o => o.querySelector('.ebp-row-name')?.textContent);
    expect(names).toEqual(['OpenAI', 'EU AI Act', 'p(doom)']); // 0.9, 0.7, 0.5
  });
});
