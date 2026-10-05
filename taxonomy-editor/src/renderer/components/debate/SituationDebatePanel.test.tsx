// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SituationDebatePanel } from './SituationDebatePanel';
import type { SituationNode } from '../../types/taxonomy';

const mockRecord = vi.hoisted(() => vi.fn());
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: mockRecord }) }));

const mockCreateSituationDebate = vi.hoisted(() => vi.fn());
const mockSetActiveTab = vi.hoisted(() => vi.fn());
const mockOpenDebateWindow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// A minimal fake zustand store: real `subscribe`/`getState` semantics, driven
// imperatively by `setActiveDebate` so tests can simulate createSituationDebate's
// real sequencing — activeDebate is set synchronously, well before its returned
// promise resolves (t/3752) — without depending on the real store's many slices.
type FakeSession = { id: string; source_type: string; source_ref: string } | null;
const fakeStore = vi.hoisted(() => ({
  activeDebate: null as FakeSession,
  listeners: [] as Array<(s: { activeDebate: FakeSession }, p: { activeDebate: FakeSession }) => void>,
}));

function setActiveDebate(session: FakeSession) {
  const prev = { activeDebate: fakeStore.activeDebate };
  fakeStore.activeDebate = session;
  const next = { activeDebate: fakeStore.activeDebate };
  for (const l of [...fakeStore.listeners]) l(next, prev);
}

vi.mock('../../hooks/useDebateStore', () => {
  const useDebateStore = (selector: (s: Record<string, unknown>) => unknown) => selector({
    loadDebate: vi.fn(),
    createSituationDebate: mockCreateSituationDebate,
    activeDebate: fakeStore.activeDebate,
  });
  useDebateStore.getState = () => ({ activeDebate: fakeStore.activeDebate });
  useDebateStore.subscribe = (listener: (s: { activeDebate: FakeSession }, p: { activeDebate: FakeSession }) => void) => {
    fakeStore.listeners.push(listener);
    return () => {
      const idx = fakeStore.listeners.indexOf(listener);
      if (idx >= 0) fakeStore.listeners.splice(idx, 1);
    };
  };
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
    mockOpenDebateWindow.mockResolvedValue(undefined);
    fakeStore.activeDebate = null;
    fakeStore.listeners = [];
    // Default: mirror createSituationDebate's real shape — set activeDebate
    // synchronously (source_type/source_ref match the launched node), then resolve.
    mockCreateSituationDebate.mockImplementation(async (nodeId: string) => {
      setActiveDebate({ id: 'sit-debate-1', source_type: 'situations', source_ref: nodeId });
      return 'sit-debate-1';
    });
  });

  // t/3752: Start must navigate as soon as the debate record exists, not wait for
  // createSituationDebate's promise to resolve — that promise blocks on the full
  // watch-only opening round (enterClarificationOrBegin, t/3629), which is minutes,
  // not seconds. This is the regression test for the reported "stuck on Starting…" bug.
  it('opens the popout and switches tabs before createSituationDebate resolves (t/3752)', async () => {
    let resolveCreate!: (id: string) => void;
    mockCreateSituationDebate.mockImplementationOnce((nodeId: string) => {
      setActiveDebate({ id: 'sit-debate-1', source_type: 'situations', source_ref: nodeId });
      return new Promise<string>((resolve) => { resolveCreate = resolve; });
    });

    render(<SituationDebatePanel node={mockNode} />);
    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockOpenDebateWindow).toHaveBeenCalledWith('sit-debate-1');
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('debate');

    // createSituationDebate's promise (config write + opening round) is still
    // unresolved at this point — resolving it now must not throw or double-navigate.
    resolveCreate('sit-debate-1');
    await waitFor(() => {
      expect(mockOpenDebateWindow).toHaveBeenCalledOnce();
    });
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

  // t/3783: config must be threaded into createSituationDebate at creation time, not
  // patched onto activeDebate afterward — a post-creation mutate-then-save was silently
  // discarded by clarificationSlice's concurrent `set({ activeDebate: { ...fresh } })`
  // replacements during the opening/clarification pipeline (TL diagnosis, t/3783#4).
  it('passes the selected pacing and adaptive-staging config into createSituationDebate (t/3783)', async () => {
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Tight' }));
    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockCreateSituationDebate).toHaveBeenCalledWith(
        'sit-007',
        expect.objectContaining({ pacing: 'tight', useAdaptiveStaging: true }),
      );
    });
  });

  // t/3928 (PI decision, t/3882#4): situation pacing must map to the SAME per-phase bounds
  // as the normal debate presets, not an independent length control that can drift apart.
  it.each([
    ['Tight', { maxConfrontationRounds: 1, maxArgumentationRounds: 1, maxConcludingRounds: 1 }],
    ['Moderate', { maxConfrontationRounds: 1, maxArgumentationRounds: 3, maxConcludingRounds: 1 }],
    ['Thorough', { maxConfrontationRounds: 2, maxArgumentationRounds: 4, maxConcludingRounds: 2 }],
  ])('maps %s pacing to the matching normal-preset phaseBoundsOverride (t/3928)', async (label, bounds) => {
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByRole('radio', { name: label }));
    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(mockCreateSituationDebate).toHaveBeenCalledWith(
        'sit-007',
        expect.objectContaining({ phaseBoundsOverride: bounds }),
      );
    });
  });

  it('surfaces an error and does not navigate when createSituationDebate rejects', async () => {
    mockCreateSituationDebate.mockRejectedValueOnce(new Error('node not found'));
    render(<SituationDebatePanel node={mockNode} />);

    fireEvent.click(screen.getByText('Start Situation Debate'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('node not found');
    });
    expect(mockSetActiveTab).not.toHaveBeenCalled();
    expect(mockOpenDebateWindow).not.toHaveBeenCalled();
  });
});
