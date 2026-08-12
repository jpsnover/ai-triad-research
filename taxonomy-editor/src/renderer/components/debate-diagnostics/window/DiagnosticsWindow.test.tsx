// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DebateSession } from '../../../types/debate';

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted)
// ---------------------------------------------------------------------------

vi.mock('./useDiagnosticsState', () => ({ useDiagnosticsState: vi.fn() }));

vi.mock('../../shared/LoadingProgress', () => ({
  LoadingProgress: ({ label }: { label?: string }) => (
    <div data-testid="loading-progress">{label}</div>
  ),
}));

vi.mock('../chat', () => ({ DiagnosticsChatSidebar: () => null }));
vi.mock('./OverviewTabRouter', () => ({ OverviewTabRouter: () => null }));
vi.mock('./EntryDetailRouter', () => ({ EntryDetailRouter: () => null }));

vi.mock('./helpers', () => ({
  DiagSearchContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  SearchBar: () => null,
  speakerLabel: (s: string) => s,
}));

vi.mock('../../shared/CopyLinkButton', () => ({ CopyLinkButton: () => null }));
vi.mock('../../shared/TheoryLink', () => ({ TheoryLink: () => null }));

vi.mock('@lib/electron-shared/povMeta', () => ({
  POV_META: {
    accelerationist: { cssVar: '--acc', label: 'Accelerationist' },
    safetyist: { cssVar: '--saf', label: 'Safetyist' },
    skeptic: { cssVar: '--skp', label: 'Skeptic' },
  },
}));

vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn(), openExternal: vi.fn() },
  isElectronMode: false,
}));

vi.mock('../../../lib/flightRecorderInit', () => ({ triggerManualDump: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { DiagnosticsWindow } from './DiagnosticsWindow';
import { useDiagnosticsState } from './useDiagnosticsState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

function makeState(overrides: Partial<ReturnType<typeof useDiagnosticsState>> = {}): ReturnType<typeof useDiagnosticsState> {
  return {
    debate: null,
    setDebate: noop,
    selectedEntry: null,
    setSelectedEntry: noop,
    localOverride: false,
    setLocalOverride: noop,
    showHelp: false,
    setShowHelp: noop,
    searchQuery: '',
    setSearchQuery: noop,
    sq: '',
    entryTab: 'details',
    setEntryTab: noop,
    overviewTab: 'transcript',
    setOverviewTab: noop,
    transcriptSpeakerFilter: null,
    setTranscriptSpeakerFilter: noop,
    focusedNodeId: null,
    setFocusedNodeId: noop,
    anFilterNodeId: '',
    setAnFilterNodeId: noop,
    anFilterMode: 'all',
    setAnFilterMode: noop,
    taxNodeMap: new Map(),
    policyMap: new Map(),
    allEdges: [],
    selectedTaxRefId: null,
    setSelectedTaxRefId: noop,
    selectedPolicyId: null,
    setSelectedPolicyId: noop,
    textCopyMenu: null,
    setTextCopyMenu: noop,
    nodeLabels: new Map(),
    tabContentRef: { current: null },
    searchInputRef: { current: null },
    sidebarTranscriptRef: { current: null },
    handleUpdateSubScore: noop,
    handleChatNavigate: noop,
    entry: null,
    diag: undefined,
    turnValTrail: undefined,
    meta: undefined,
    an: undefined,
    commitments: undefined,
    nodeWeights: new Map(),
    proxiedModeratorTrace: null,
    effectiveOverviewTab: 'transcript',
    perTurnUtilities: [],
    matchCount: 0,
    deepLinkError: null,
    ...overrides,
  } as ReturnType<typeof useDiagnosticsState>;
}

const minimalDebate: DebateSession = {
  id: 'test-debate',
  title: 'Test Debate',
  created_at: '2026-01-01T00:00:00.000Z',
  transcript: [],
  topic: { text: 'test', scope: null, critique: null } as unknown as DebateSession['topic'],
} as unknown as DebateSession;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiagnosticsWindow — loading state', () => {
  const mockUseDiagnosticsState = vi.mocked(useDiagnosticsState);

  beforeEach(() => { vi.clearAllMocks(); });

  it('shows LoadingProgress while debate is null and no error', () => {
    mockUseDiagnosticsState.mockReturnValue(makeState({ debate: null, deepLinkError: null }));
    render(<DiagnosticsWindow />);
    expect(screen.getByTestId('loading-progress')).toBeTruthy();
    expect(screen.getByText('Loading debate…')).toBeTruthy();
  });

  it('hides LoadingProgress once debate is loaded', () => {
    mockUseDiagnosticsState.mockReturnValue(makeState({ debate: minimalDebate, deepLinkError: null }));
    render(<DiagnosticsWindow />);
    expect(screen.queryByTestId('loading-progress')).toBeNull();
  });

  it('shows error text instead of LoadingProgress on deepLinkError', () => {
    mockUseDiagnosticsState.mockReturnValue(makeState({ debate: null, deepLinkError: 'Debate not found: xyz' }));
    render(<DiagnosticsWindow />);
    expect(screen.queryByTestId('loading-progress')).toBeNull();
    expect(screen.getByText('Debate not found: xyz')).toBeTruthy();
  });
});
