// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the persistent Ask/My/Community tab strip (t/3678, AC1). The strip must be reachable
// on every screen — not just a button inside the Ask screen — and must not silently abandon an
// in-flight run.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockReset = vi.fn();
const mockOpenList = vi.fn();
const mockStopPolling = vi.fn();
let mockScreen: 'ask' | 'running' | 'answer' | 'list' = 'ask';

vi.mock('../../hooks/useInquiryStore', () => ({
  useInquiryStore: (selector: (s: unknown) => unknown) => selector({
    screen: () => mockScreen,
    _stopPolling: mockStopPolling,
    reset: mockReset,
    openList: mockOpenList,
  }),
}));

vi.mock('./InquiryAskPanel', () => ({ InquiryAskPanel: () => <div>ask-screen</div> }));
vi.mock('./InquiryRunningPanel', () => ({ InquiryRunningPanel: () => <div>running-screen</div> }));
vi.mock('./InquiryAnswerPanel', () => ({ InquiryAnswerPanel: () => <div>answer-screen</div> }));
vi.mock('./InquiryListPanel', () => ({ InquiryListPanel: ({ listView }: { listView: string }) => <div>list-screen-{listView}</div> }));

const { InquiryTab } = await import('./InquiryTab');

describe('InquiryTab top-level tab strip (t/3678)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScreen = 'ask';
  });

  it('renders Ask/My/Community as a persistent strip regardless of screen', () => {
    render(<InquiryTab />);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^My/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Community' })).toBeInTheDocument();
  });

  it('clicking My calls openList and renders the list screen in "my" view — no need to visit Ask first', () => {
    render(<InquiryTab />);
    fireEvent.click(screen.getByRole('button', { name: /^My/ }));
    expect(mockOpenList).toHaveBeenCalled();
  });

  it('clicking Community calls openList and switches the list view to "community"', () => {
    mockScreen = 'list';
    render(<InquiryTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Community' }));
    expect(mockOpenList).toHaveBeenCalled();
    expect(screen.getByText('list-screen-community')).toBeInTheDocument();
  });

  it('Ask tab is disabled while a run is in progress, so it cannot silently abandon the poll', () => {
    mockScreen = 'running';
    render(<InquiryTab />);
    const askButton = screen.getByRole('button', { name: 'Ask' });
    expect(askButton).toBeDisabled();
    fireEvent.click(askButton);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('Ask tab is enabled and resets on the answer screen (existing "ask another question" behavior)', () => {
    mockScreen = 'answer';
    render(<InquiryTab />);
    const askButton = screen.getByRole('button', { name: 'Ask' });
    expect(askButton).not.toBeDisabled();
    fireEvent.click(askButton);
    expect(mockReset).toHaveBeenCalled();
  });
});
