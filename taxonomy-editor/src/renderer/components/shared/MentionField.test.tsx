// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1898 — the mention render layer: MentionField turns a reconstructed field + its
// mentions into `.ref-link` buttons; useContainerMentions fetches via the bridge and
// degrades to [] on error; useMentionRenderer ties them together and routes clicks to
// the debate store's setSelectedRef (opening the shared DetailPane).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mention } from '@lib/entities/mentionTypes';

const setSelectedRef = vi.fn();
vi.mock('../../hooks/useDebateStore', () => ({ useDebateStore: { getState: () => ({ setSelectedRef }) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('@bridge', () => ({ api: { getContainerMentions: vi.fn() } }));

import { api } from '@bridge';
import { MentionField, useContainerMentions, useMentionRenderer } from './MentionField';
import type { ContainerField, ReconstructedContainer } from './mentionText';

const getMentions = api.getContainerMentions as unknown as ReturnType<typeof vi.fn>;
const labelField: ContainerField = { name: 'label', text: 'OpenAI builds AI', start: 0 };
const mention: Mention = { entity_ref: 'org-001', quote: 'OpenAI', offset: 0, discovered_by: 'alias' };

beforeEach(() => {
  setSelectedRef.mockReset();
  getMentions.mockReset();
});

describe('MentionField', () => {
  it('renders a mention as a .ref-link button and the rest as plain text', () => {
    const { container } = render(<MentionField field={labelField} mentions={[mention]} onSelectRef={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Organization: OpenAI — open details' });
    expect(btn).toHaveClass('ref-link');
    expect(btn).toHaveAttribute('data-ref-kind', 'organization');
    expect(btn).toHaveTextContent('OpenAI');
    // the full field text is preserved (mention + surrounding plain text)
    expect(container.textContent).toBe('OpenAI builds AI');
  });

  it('routes a click to onSelectRef with the parsed EntityRef', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MentionField field={labelField} mentions={[mention]} onSelectRef={onSelect} />);
    await user.click(screen.getByRole('button', { name: /OpenAI/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'organization', id: 'org-001' });
  });

  it('renders plain text when there are no mentions', () => {
    render(<MentionField field={labelField} mentions={[]} onSelectRef={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('OpenAI builds AI')).toBeInTheDocument();
  });
});

describe('useContainerMentions', () => {
  it('fetches the container mentions via the bridge', async () => {
    getMentions.mockResolvedValue({ text_sha256: 'x', extracted_at: 't', mentions: [mention] });
    const { result } = renderHook(() => useContainerMentions('node:acc-desires-001'));
    await waitFor(() => expect(result.current).toEqual([mention]));
    expect(getMentions).toHaveBeenCalledWith('node:acc-desires-001');
  });

  it('returns [] without fetching for a null container id', () => {
    const { result } = renderHook(() => useContainerMentions(null));
    expect(result.current).toEqual([]);
    expect(getMentions).not.toHaveBeenCalled();
  });

  it('degrades to [] when the bridge rejects (e.g. desktop transport unwired)', async () => {
    getMentions.mockRejectedValue(new Error('not available in desktop mode'));
    const { result } = renderHook(() => useContainerMentions('node:x'));
    await waitFor(() => expect(getMentions).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

describe('useMentionRenderer', () => {
  const container: ReconstructedContainer = { text: 'OpenAI builds AI', fields: [labelField] };

  function Harness({ containerId }: { containerId: string | null }) {
    const renderField = useMentionRenderer(containerId, container);
    return <div data-testid="out">{renderField('label', 'OpenAI builds AI')}</div>;
  }

  it('linkifies the field once mentions load and routes clicks to the debate store', async () => {
    getMentions.mockResolvedValue({ text_sha256: 'x', extracted_at: 't', mentions: [mention] });
    const user = userEvent.setup();
    render(<Harness containerId="node:acc-desires-001" />);
    const btn = await screen.findByRole('button', { name: /OpenAI/ });
    await user.click(btn);
    expect(setSelectedRef).toHaveBeenCalledWith({ kind: 'organization', id: 'org-001' });
  });

  it('renders the fallback for an absent field', () => {
    getMentions.mockResolvedValue({ text_sha256: 'x', extracted_at: 't', mentions: [] });
    function Missing() {
      const renderField = useMentionRenderer('node:x', container);
      return <div data-testid="out">{renderField('plain_description', 'FALLBACK')}</div>;
    }
    render(<Missing />);
    expect(screen.getByTestId('out')).toHaveTextContent('FALLBACK');
  });
});
