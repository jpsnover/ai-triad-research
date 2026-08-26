// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SituationDebatePanel } from './SituationDebatePanel';
import type { SituationNode } from '../../types/taxonomy';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

const mockRunClarification = vi.hoisted(() => vi.fn());
const mockSaveDebate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateSituationDebate = vi.hoisted(() => vi.fn().mockResolvedValue('sit-debate-1'));
const mockSetActiveTab = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useDebateStore', () => {
  const storeState = {
    createDebate: vi.fn(),
    loadDebate: vi.fn(),
    createSituationDebate: mockCreateSituationDebate,
    activeDebate: { id: 'sit-debate-1', debate_model: 'gemini-flash' },
    saveDebate: mockSaveDebate,
    runClarification: mockRunClarification,
  };
  const useDebateStore = (selector: (s: typeof storeState) => unknown) => selector(storeState);
  useDebateStore.getState = () => storeState;
  return { useDebateStore };
});

vi.mock('../../hooks/useTaxonomyStore', () => ({
  MODELS_BY_BACKEND: { gemini: [{ value: 'gemini-flash', label: 'Gemini Flash' }] },
  useTaxonomyStore: () => ({ geminiModel: 'gemini-flash', setActiveTab: mockSetActiveTab }),
}));

const mockNode = {
  id: 'sit-007',
  label: 'Test situation',
  debate_refs: [],
} as unknown as SituationNode;

describe('SituationDebatePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDebate.mockResolvedValue(undefined);
    mockCreateSituationDebate.mockResolvedValue('sit-debate-1');
  });

  // t/3031 regression: handleLaunch must call runClarification after saveDebate.
  // Without this, situation debates are created but never generate (stuck at transcript_length=0).
  it('calls runClarification after saveDebate on launch (t/3031)', async () => {
    render(<SituationDebatePanel node={mockNode} onLaunched={vi.fn()} />);

    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockRunClarification).toHaveBeenCalledOnce();
    });
    expect(mockSaveDebate).toHaveBeenCalledWith('SituationDebatePanel:applyConfig');
    expect(mockSaveDebate.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunClarification.mock.invocationCallOrder[0],
    );
  });
});
