// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SituationDebatePanel } from './SituationDebatePanel';
import type { SituationNode } from '../../types/taxonomy';

const mockRecord = vi.hoisted(() => vi.fn());
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: mockRecord }) }));

const mockRunClarification = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSaveDebate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateSituationDebate = vi.hoisted(() => vi.fn().mockResolvedValue('sit-debate-1'));
const mockSetActiveTab = vi.hoisted(() => vi.fn());
const mockOpenDebateWindow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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

vi.mock('@bridge', () => ({
  api: { openDebateWindow: mockOpenDebateWindow },
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
    mockRunClarification.mockResolvedValue(undefined);
    mockOpenDebateWindow.mockResolvedValue(undefined);
  });

  // t/3031 regression: handleLaunch must call runClarification after saveDebate.
  // Without this, situation debates are created but never generate (stuck at transcript_length=0).
  it('calls runClarification after saveDebate on launch (t/3031)', async () => {
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockRunClarification).toHaveBeenCalledOnce();
    });
    expect(mockSaveDebate).toHaveBeenCalledWith('SituationDebatePanel:applyConfig');
    expect(mockSaveDebate.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunClarification.mock.invocationCallOrder[0],
    );
  });

  // t/3749: Start must actually take the user to the debate, not just switch app tabs
  // (which lands on a summary card requiring a manual "Open in Window" click).
  it('opens the debate popout window and switches tabs on launch (t/3749)', async () => {
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockOpenDebateWindow).toHaveBeenCalledWith('sit-debate-1');
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('debate');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // t/3749: a fire-and-forget runClarification silently lost failures with no record
  // (the defect this ticket flagged) — it must be awaited and its rejection logged,
  // and the launch must still proceed to open the debate window.
  it('logs a WARN and still opens the window when runClarification rejects (t/3749)', async () => {
    mockRunClarification.mockRejectedValueOnce(new Error('clarification boom'));
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockOpenDebateWindow).toHaveBeenCalledWith('sit-debate-1');
    });
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      debate_id: 'sit-debate-1',
      message: expect.stringContaining('runClarification'),
    }));
    expect(mockSetActiveTab).toHaveBeenCalledWith('debate');
  });

  // t/3749: at-cap must surface to the user instead of silently doing nothing —
  // the original bug's symptom was "Starting…" with no signal of what happened.
  it('shows an inline error when the popout is at the open-window cap (t/3749)', async () => {
    mockOpenDebateWindow.mockResolvedValueOnce({ atCap: true });
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/max 5 open/i);
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('debate');
  });
});
