// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpEdReader } from './OpEdReader';
import type { OpEdSet, OpEdMember } from '../../../../../lib/oped/types';

function member(overrides: Partial<OpEdMember> = {}): OpEdMember {
  return {
    pov: 'safetyist',
    status: 'complete',
    headline: 'Mandatory Audits Are the Floor',
    subtitle: 'Why the oversight bill must go further',
    body: 'The lede opens on the news hook.\n\nA second paragraph.',
    wordCount: 812,
    grounding: [],
    ...overrides,
  };
}

function makeSet(members: OpEdMember[], overrides: Partial<OpEdSet> = {}): OpEdSet {
  return {
    schema_version: 1,
    set_id: 'set-1',
    topic: 'Audits',
    params: { wordCount: 800, model: 'gemini-3.6-flash', outlet: 'The Washington Post' },
    created_at: '2026-08-08T12:00:00Z',
    opeds: members,
    ...overrides,
  };
}

describe('OpEdReader — single voice', () => {
  it('renders no tab strip and the headline as the sole h1', () => {
    render(<OpEdReader set={makeSet([member()])} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Mandatory Audits Are the Floor');
  });

  it('renders the subtitle and camp label in the accent strip', () => {
    render(<OpEdReader set={makeSet([member()])} />);
    expect(screen.getByText('Why the oversight bill must go further')).toBeTruthy();
    expect(screen.getByText(/SAFETYIST/)).toBeTruthy();
  });

  it('shows the voice-only notice when grounding is empty', () => {
    render(<OpEdReader set={makeSet([member({ grounding: [] })])} />);
    expect(screen.getByText(/Written from voice alone/i)).toBeTruthy();
  });

  it('renders a grounding table (not the voice-only notice) when grounding is present', () => {
    render(<OpEdReader set={makeSet([member({
      grounding: [{ node_id: 'saf-belief-014', label: 'A belief', category: 'Belief', pov: 'safetyist', relevance: '0.82', how_reflected: 'Grounds the claim' }],
    })])} />);
    expect(screen.queryByText(/Written from voice alone/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'saf-belief-014' })).toBeTruthy();
    expect(screen.getByText('Grounds the claim')).toBeTruthy();
  });
});

describe('OpEdReader — failed / cancelled member', () => {
  it('renders an honest notice instead of a body for a failed voice', () => {
    render(<OpEdReader set={makeSet([member({ status: 'failed' })])} />);
    expect(screen.getByText(/This voice failed to generate/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('renders a cancelled notice for a cancelled voice', () => {
    render(<OpEdReader set={makeSet([member({ status: 'cancelled' })])} />);
    expect(screen.getByText(/was cancelled/i)).toBeTruthy();
  });
});

describe('OpEdReader — multi-voice set', () => {
  const set = makeSet([
    member({ pov: 'skeptic', headline: 'Skeptic headline' }),
    member({ pov: 'safetyist', headline: 'Safetyist headline' }),
  ]);

  it('renders a tablist with one tab per voice', () => {
    render(<OpEdReader set={set} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('shows the first voice active by default', () => {
    render(<OpEdReader set={set} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Skeptic headline');
  });

  it('clicking a tab swaps the article', () => {
    render(<OpEdReader set={set} />);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Safetyist headline');
  });

  it('ArrowRight moves the active tab (roving)', () => {
    render(<OpEdReader set={set} />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Safetyist headline');
  });

  it('only one h1 is present at a time (sole-h1 invariant)', () => {
    render(<OpEdReader set={set} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
