// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2296 — the mount effect that kicks off news-report generation fired twice
// under React Strict Mode's dev double-invoke: both invokes run synchronously
// before the async generateNewsReport() sets newsReportLoading in the store, so
// the store-state guard read false both times. A useRef set synchronously on
// the first fire is the fix; this test pins it under a StrictMode wrapper.

import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { NewsReportModal } from './NewsReportModal';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: {} }));

const debateStore: Record<string, any> = {
  activeDebate: null,
  newsReport: null,
  newsReportLoading: false,
  newsReportError: null,
  generateNewsReport: vi.fn(),
};

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: (selector: any) => selector(debateStore),
}));

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: any) => fn }));

beforeEach(() => {
  debateStore.activeDebate = null;
  debateStore.newsReport = null;
  debateStore.newsReportLoading = false;
  debateStore.newsReportError = null;
  // The async action never resolves here — the guard must hold without the
  // store ever flipping newsReportLoading (that is the whole point of t/2296).
  debateStore.generateNewsReport = vi.fn(() => new Promise(() => {}));
});

afterEach(() => { vi.clearAllMocks(); });

describe('NewsReportModal — mount generation guard (t/2296)', () => {
  it('generates exactly once under Strict Mode double-invoke', async () => {
    render(
      <StrictMode>
        <NewsReportModal onClose={vi.fn()} />
      </StrictMode>
    );
    await waitFor(() => expect(debateStore.generateNewsReport).toHaveBeenCalled());
    expect(debateStore.generateNewsReport).toHaveBeenCalledTimes(1);
  });

  it('does not generate when an article is already present', async () => {
    debateStore.newsReport = '# Existing headline\nsubhead\n\nbody';
    render(
      <StrictMode>
        <NewsReportModal onClose={vi.fn()} />
      </StrictMode>
    );
    // Let effects flush, then assert no generation was triggered.
    await waitFor(() => expect(document.querySelector('.news-report-modal-window')).toBeTruthy());
    expect(debateStore.generateNewsReport).not.toHaveBeenCalled();
  });
});
