// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PovNode } from '../../types/taxonomy';

// AnalysisPanel is the AI-heavy panel; its render paths fan out into generation
// flows. This is a smoke test of the idle path (no analysis running → renders
// nothing) — enough to guard the import + mount without coupling to AI internals.

let mockStoreState: Record<string, any> = {};

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('@bridge', () => ({ api: { generateText: vi.fn(), generateTextWithSearch: vi.fn() } }));
vi.mock('../settings/ApiKeyErrorMessage', () => ({ ApiKeyErrorMessage: () => null }));
vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => mockStoreState;
  hook.getState = () => mockStoreState;
  return { useTaxonomyStore: hook };
});

const { AnalysisPanel } = await import('./AnalysisPanel');

describe('AnalysisPanel (t/1025)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockStoreState = {};
  });

  it('mounts cleanly and renders nothing when no analysis is active', () => {
    const { container } = render(<AnalysisPanel />);
    expect(container.firstChild).toBeNull();
  });
});

describe('AnalysisPanel — critique accept with unregistered policy_id (t/4033)', () => {
  afterEach(() => { mockStoreState = {}; });

  const critiqueMarkdown = [
    '#### Critique Summary',
    'Some summary.',
    '',
    '```json',
    '{"graph_attributes": {"policy_actions": [{"policy_id": "pol-unknown-999", "action": "Some New Action", "framing": "neutral"}]}}',
    '```',
    '',
  ].join('\n');

  function baseState(overrides: Record<string, any> = {}) {
    return {
      analysisResult: critiqueMarkdown,
      analysisLoading: false,
      analysisError: null,
      analysisStep: 0,
      analysisRetry: null,
      analysisCached: false,
      analysisElementA: null,
      analysisElementB: null,
      analysisTitle: 'Critique',
      analysisCritiquePov: 'accelerationist',
      analysisCritiqueNodeId: 'acc-beliefs-001',
      analysisCritiqueOriginalNode: { id: 'acc-beliefs-001', graph_attributes: {} } as unknown as PovNode,
      clearAnalysis: vi.fn(),
      runAnalyzeDistinction: vi.fn(),
      runNodeCritique: vi.fn(),
      updatePovNode: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      policyRegistry: [{ id: 'pol-001', action: 'Existing Action' }],
      geminiModel: 'gemini-2.5-flash',
      ...overrides,
    };
  }

  it('blocks accept and surfaces an error when a policy_id is unregistered with no text match', async () => {
    mockStoreState = baseState();
    render(<AnalysisPanel />);
    fireEvent.click(screen.getByText('Accept'));
    const errorEl = await screen.findByText(/Can't accept/);
    expect(errorEl.textContent).toContain('Some New Action');
    expect(mockStoreState.updatePovNode).not.toHaveBeenCalled();
    expect(mockStoreState.save).not.toHaveBeenCalled();
  });

  it('accepts and saves once the policy_id resolves via an action-text match', async () => {
    mockStoreState = baseState({
      policyRegistry: [{ id: 'pol-002', action: 'Some New Action' }],
    });
    render(<AnalysisPanel />);
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(mockStoreState.save).toHaveBeenCalledTimes(1));
    expect(mockStoreState.updatePovNode).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Can't accept/)).not.toBeInTheDocument();
  });
});
