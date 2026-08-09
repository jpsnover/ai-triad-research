// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Contract test (t/2399): DebatePopoutWindow routes community=true → loadCommunityDebateSession,
// community=false → loadDebate. Guards the OPEN path so a missing source flag can't silently
// call the wrong endpoint and 404.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const {
  mockLoadCommunityDebateSession,
  mockLoadDebate,
  mockLoadDebateFromData,
  mockLoadAll,
  mockOnDebateWindowLoad,
} = vi.hoisted(() => ({
  mockLoadCommunityDebateSession: vi.fn().mockResolvedValue({ id: 'abc-123', found: true }),
  mockLoadDebate: vi.fn().mockResolvedValue(undefined),
  mockLoadDebateFromData: vi.fn(),
  mockLoadAll: vi.fn().mockResolvedValue(undefined),
  mockOnDebateWindowLoad: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('@bridge', () => ({
  api: {
    loadCommunityDebateSession: mockLoadCommunityDebateSession,
    onDebateWindowLoad: mockOnDebateWindowLoad,
  },
}));

vi.mock('../../hooks/useDebateStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useDebateStore = (selector: (s: any) => any) =>
    selector({ activeDebateId: null, debateError: null });
  useDebateStore.getState = () => ({
    loadDebate: mockLoadDebate,
    loadDebateFromData: mockLoadDebateFromData,
    setError: vi.fn(),
  });
  return { useDebateStore };
});

vi.mock('../../hooks/usePopoutTheme', () => ({ usePopoutTheme: vi.fn() }));
vi.mock('../../hooks/useTheoryLinkHotkey', () => ({ useTheoryLinkHotkey: vi.fn() }));
vi.mock('../../hooks/useDebateStore/shared/guards', () => ({ markAsPopout: vi.fn() }));

vi.mock('../../hooks/useTaxonomyStore', () => {
  const useTaxonomyStore = vi.fn();
  useTaxonomyStore.getState = () => ({ loadAll: mockLoadAll });
  return { useTaxonomyStore };
});

vi.mock('../debate-workspace', () => ({ DebateWorkspace: () => null }));

vi.mock('./useBriefTimeoutEvents', () => ({
  useBriefTimeoutEvents: () => ({
    toastData: null,
    dialogData: null,
    dismissToast: vi.fn(),
    dismissDialog: vi.fn(),
    retryWithModel: vi.fn(),
    promoteToDiag: vi.fn(),
  }),
}));

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('./BriefTimeoutToast', () => ({ BriefTimeoutToast: () => null }));
vi.mock('./BriefTimeoutDialog', () => ({ BriefTimeoutDialog: () => null }));
vi.mock('./DebatePopoutWindow.css', () => ({}));

import { DebatePopoutWindow } from './DebatePopoutWindow';

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { hash },
  });
}

describe('DebatePopoutWindow — runLoad routing (t/2399)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCommunityDebateSession.mockResolvedValue({ id: 'abc-123', found: true });
    mockLoadAll.mockResolvedValue(undefined);
    mockOnDebateWindowLoad.mockReturnValue(() => {});
  });

  it('calls loadCommunityDebateSession — not loadDebate — when source=community', async () => {
    setHash('#/debate?id=abc-123&source=community');
    render(<DebatePopoutWindow />);
    await waitFor(() => {
      expect(mockLoadCommunityDebateSession).toHaveBeenCalledWith('abc-123');
    });
    expect(mockLoadDebate).not.toHaveBeenCalled();
  });

  it('calls loadDebate — not loadCommunityDebateSession — for personal debates', async () => {
    setHash('#/debate?id=abc-123');
    render(<DebatePopoutWindow />);
    await waitFor(() => {
      expect(mockLoadDebate).toHaveBeenCalledWith('abc-123');
    });
    expect(mockLoadCommunityDebateSession).not.toHaveBeenCalled();
  });
});
