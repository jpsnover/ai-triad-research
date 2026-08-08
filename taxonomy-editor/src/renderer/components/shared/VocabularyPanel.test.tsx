// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2300 (sibling of t/2296) — the mount effect that loads the dictionary fired
// twice under React Strict Mode's dev double-invoke. loadDictionary is an
// idempotent local read (no AI cost), so impact is just a redundant fetch, but
// a useRef guard set synchronously on the first fire holds it to one call. This
// test pins that under a StrictMode wrapper.

import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { VocabularyPanel } from './VocabularyPanel';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

const bridgeGet = vi.fn();
vi.mock('../../bridge/web-bridge', () => ({
  bridgeGet: (...args: unknown[]) => bridgeGet(...args),
}));

beforeEach(() => {
  // No electronAPI under jsdom → the component reads via bridgeGet('/api/dictionary').
  bridgeGet.mockResolvedValue({ standardized: [], colloquial: [], lintViolations: [] });
});

afterEach(() => { vi.clearAllMocks(); });

describe('VocabularyPanel — mount load guard (t/2300)', () => {
  it('loads the dictionary exactly once under Strict Mode double-invoke', async () => {
    render(
      <StrictMode>
        <VocabularyPanel />
      </StrictMode>
    );
    await waitFor(() => expect(bridgeGet).toHaveBeenCalled());
    expect(bridgeGet).toHaveBeenCalledTimes(1);
    expect(bridgeGet).toHaveBeenCalledWith('/api/dictionary');
  });
});
