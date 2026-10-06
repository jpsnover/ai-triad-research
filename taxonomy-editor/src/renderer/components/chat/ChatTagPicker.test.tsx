// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockRegistry, mockNodes } = vi.hoisted(() => ({
  mockRegistry: { povs: {} as Record<string, { id: string; label: string }[]> },
  mockNodes: { accelerationist: [] as { id: string; pov_tags?: string[] }[] },
}));

vi.mock('@lib/schema/povTags', () => ({
  loadPovTagRegistry: () => mockRegistry,
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(
    () => ({}),
    { getState: () => ({ accelerationist: { nodes: mockNodes.accelerationist } }) },
  ),
}));

import { ChatTagPicker, seatTagLabel } from './ChatTagPicker';

describe('ChatTagPicker (t/3959)', () => {
  beforeEach(() => {
    mockRegistry.povs = {};
    mockNodes.accelerationist = [];
  });

  it('renders nothing when the registry has no entries for the POV', () => {
    mockRegistry.povs = {};
    const { container } = render(<ChatTagPicker pov="accelerationist" seatTag={undefined} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows mode radios once a tag is selected', async () => {
    mockRegistry.povs = { accelerationist: [{ id: 'critical', label: 'Critical' }] };
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChatTagPicker pov="accelerationist" seatTag={undefined} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('accelerationist tag'), 'critical');
    expect(onChange).toHaveBeenCalledWith({ pov_tag: 'critical', tag_mode: 'scope' });
  });

  it('shows the checkTagScope counts in Scope mode', () => {
    mockRegistry.povs = { accelerationist: [{ id: 'critical', label: 'Critical' }] };
    mockNodes.accelerationist = [
      { id: 'a1', pov_tags: ['critical'] },
      { id: 'a2', pov_tags: ['critical'] },
      { id: 'a3' },
    ];
    render(
      <ChatTagPicker
        pov="accelerationist"
        seatTag={{ pov_tag: 'critical', tag_mode: 'scope' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 in scope, 1 untagged/)).toBeInTheDocument();
    expect(screen.getByText(/below the minimum/)).toBeInTheDocument();
  });

  it('seatTagLabel resolves a registered tag and returns undefined otherwise', () => {
    const registry = { povs: { accelerationist: [{ id: 'critical', label: 'Critical', soul_doc: 'x', description: 'd' }] } } as never;
    expect(seatTagLabel('accelerationist', 'critical', registry)).toBe('Critical');
    expect(seatTagLabel('accelerationist', 'missing', registry)).toBeUndefined();
    expect(seatTagLabel('accelerationist', undefined, registry)).toBeUndefined();
  });
});
