// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1882 §5 — EntityDetail renders the landed Entity contract read-only. These tests
// pin the field mapping (name/badge/dolce/aliases/status/description/refs/provenance),
// the deprecated + redirected_from affordances, and — critically — that absent optional
// fields OMIT their line rather than rendering "undefined" (AC #4).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Entity } from '@lib/entities/types';

// ExternalLinkRow (via DetailPrimitives) imports the bridge; stub it — no link is
// clicked here, and flight-recorder must not touch a real recorder.
vi.mock('@bridge', () => ({ api: { openExternal: vi.fn() } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { EntityDetail } from './EntityDetail';

const fullEntity: Entity = {
  id: 'ent-042',
  name: 'OpenAI',
  aliases: ['OpenAI Inc.', 'OpenAI LP'],
  entity_type: 'institution',
  dolce_category: 'non-agentive-social-object',
  description: 'An institution that develops and deploys frontier AI systems.',
  external_refs: [{ label: 'Website', url: 'https://openai.com' }],
  source_refs: ['2023-frontier-safety', 'eu-ai-act-analysis'],
  status: 'approved',
  discovered_by: { model: 'gemini-flash', usage_id: 'u-4471' },
  confidence: 0.86,
  created_at: '2026-01-01',
  last_modified: '2026-01-02',
};

describe('EntityDetail', () => {
  it('does not crash when aliases is null (real-data defect, t/1884#3)', () => {
    // ent-034 "Claude" (the mention target) has aliases:null despite the string[] type.
    render(<EntityDetail entity={{ ...fullEntity, aliases: null as unknown as string[] }} />);
    expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.queryByText(/^also:/)).not.toBeInTheDocument(); // no alias row, no throw
  });

  it('renders the full field set', () => {
    render(<EntityDetail entity={fullEntity} />);
    expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByText('institution')).toBeInTheDocument();
    // dolce humanized for display; raw slug preserved on the title attribute
    const dolce = screen.getByText('non agentive social object');
    expect(dolce).toHaveAttribute('title', 'non-agentive-social-object');
    expect(screen.getByText('also: OpenAI Inc., OpenAI LP')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(fullEntity.description)).toBeInTheDocument();
    expect(screen.getByText('References')).toBeInTheDocument();
    expect(screen.getByText('Appears in')).toBeInTheDocument();
    expect(screen.getByText('doc: 2023-frontier-safety')).toBeInTheDocument();
    expect(screen.getByText('Discovered by gemini-flash · usage u-4471')).toBeInTheDocument();
    expect(screen.getByText('Confidence 0.86')).toBeInTheDocument();
  });

  it('source chips are non-interactive (no viewer target yet — spec open-Q3)', () => {
    render(<EntityDetail entity={fullEntity} />);
    const chip = screen.getByText('doc: 2023-frontier-safety');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('role');
    expect(chip.closest('button')).toBeNull();
  });

  it('omits every optional line when its field is absent — never renders "undefined"', () => {
    const minimal: Entity = {
      id: 'ent-100',
      name: 'Bare Entity',
      aliases: [],
      entity_type: 'artifact',
      dolce_category: 'non-agentive-functional-artifact',
      description: 'An artifact with no optional fields.',
      status: 'proposed',
      created_at: '2026-01-01',
      last_modified: '2026-01-02',
    };
    const { container } = render(<EntityDetail entity={minimal} />);
    expect(container.textContent).not.toContain('undefined');
    expect(screen.queryByText(/^also:/)).not.toBeInTheDocument();
    expect(screen.queryByText('References')).not.toBeInTheDocument();
    expect(screen.queryByText('Appears in')).not.toBeInTheDocument();
    expect(screen.queryByText(/Discovered by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
    expect(screen.getByText('Proposed')).toBeInTheDocument();
  });

  it('shows the deprecated banner (muted warning) and keeps rendering the record', () => {
    render(<EntityDetail entity={{ ...fullEntity, status: 'deprecated' }} />);
    expect(screen.getByText('This entity is deprecated.')).toBeInTheDocument();
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
    expect(screen.getByText(fullEntity.description)).toBeInTheDocument();
  });

  it('shows a redirect note when a merge tombstone was followed', () => {
    render(<EntityDetail entity={fullEntity} redirectedFrom="ent-017" />);
    expect(screen.getByText('Redirected from ent-017')).toBeInTheDocument();
  });

  it('does not show a redirect note by default', () => {
    render(<EntityDetail entity={fullEntity} />);
    expect(screen.queryByText(/^Redirected from/)).not.toBeInTheDocument();
  });
});
