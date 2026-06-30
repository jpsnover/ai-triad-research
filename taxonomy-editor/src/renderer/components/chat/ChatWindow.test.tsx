// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────

const mockLoadAll = vi.fn().mockResolvedValue(undefined);
const mockInitAIModels = vi.fn().mockResolvedValue(undefined);
const mockInitDebateSessions = vi.fn();
const mockLoadChat = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: Object.assign(
    () => ({}),
    { getState: () => ({ loadAll: mockLoadAll }) },
  ),
  initAIModels: (...args: unknown[]) => mockInitAIModels(...args),
}));

vi.mock('../../hooks/useChatStore', () => ({
  useChatStore: Object.assign(
    () => ({}),
    { getState: () => ({ loadChat: mockLoadChat }) },
  ),
}));

vi.mock('../../hooks/useDebateStore', () => ({
  initDebateSessions: () => mockInitDebateSessions(),
}));

vi.mock('./ChatTab', () => ({
  ChatTab: () => <div data-testid="chat-tab">ChatTab</div>,
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

import { ChatWindow } from './ChatWindow';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('ChatWindow', () => {
  beforeEach(() => {
    mockInitAIModels.mockClear().mockResolvedValue(undefined);
    mockLoadAll.mockClear().mockResolvedValue(undefined);
    mockInitDebateSessions.mockClear();
    mockLoadChat.mockClear().mockResolvedValue(undefined);
    window.location.hash = '';
  });

  it('shows loading state initially', () => {
    mockInitAIModels.mockReturnValue(new Promise(() => {}));
    render(<ChatWindow />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders ChatTab after successful initialization', async () => {
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-tab')).toBeInTheDocument();
    });
    expect(mockInitAIModels).toHaveBeenCalled();
    expect(mockLoadAll).toHaveBeenCalled();
    expect(mockInitDebateSessions).toHaveBeenCalled();
  });

  it('renders ChatTab even after initialization error', async () => {
    mockInitAIModels.mockRejectedValue(new Error('init failed'));
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-tab')).toBeInTheDocument();
    });
  });

  it('deep-links to a chat when hash contains ?id=', async () => {
    window.location.hash = '#chat-window?id=chat-abc';
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-tab')).toBeInTheDocument();
    });
    expect(mockLoadChat).toHaveBeenCalledWith('chat-abc');
  });

  it('does not call loadChat when hash has no id param', async () => {
    window.location.hash = '#chat-window';
    render(<ChatWindow />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-tab')).toBeInTheDocument();
    });
    expect(mockLoadChat).not.toHaveBeenCalled();
  });
});
