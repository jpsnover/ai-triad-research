// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// AnalysisPanel is the AI-heavy panel; its render paths fan out into generation
// flows. This is a smoke test of the idle path (no analysis running → renders
// nothing) — enough to guard the import + mount without coupling to AI internals.

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('@bridge', () => ({ api: { generateText: vi.fn(), generateTextWithSearch: vi.fn() } }));
vi.mock('../settings/ApiKeyErrorMessage', () => ({ ApiKeyErrorMessage: () => null }));
vi.mock('../../hooks/useTaxonomyStore', () => {
  // Idle: analysisResult / analysisLoading / analysisError all falsy → returns null.
  const hook = () => ({});
  hook.getState = () => ({});
  return { useTaxonomyStore: hook };
});

const { AnalysisPanel } = await import('./AnalysisPanel');

describe('AnalysisPanel (t/1025)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('mounts cleanly and renders nothing when no analysis is active', () => {
    const { container } = render(<AnalysisPanel />);
    expect(container.firstChild).toBeNull();
  });
});
