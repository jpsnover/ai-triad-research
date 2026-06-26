// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebateWorkspace } from './DebateWorkspace';

// ── Store mocks ───────────────────────────────────────────────

const mockStore: Record<string, any> = {
  activeDebate: null,
  debateLoading: false,
  debateError: null,
  debateGenerating: null,
  runClarification: vi.fn(),
  runOpeningStatements: vi.fn(),
  saveDebate: vi.fn(),
  compressOldTranscript: vi.fn(),
  diagnosticsEnabled: false,
  toggleDiagnostics: vi.fn(),
  selectedDiagEntry: null,
  selectDiagEntry: vi.fn(),
  diagPopoutOpen: false,
  setDiagPopoutOpen: vi.fn(),
  responseLength: 'detailed',
  setResponseLength: vi.fn(),
  factCheckSelection: vi.fn(),
  reExtractClaims: vi.fn(),
};

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign(
    (selector: any) => selector(mockStore),
    { getState: () => mockStore },
  ),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}));

const mockTaxStore: Record<string, any> = {
  runSemanticSearch: vi.fn(),
  setFindQuery: vi.fn(),
  setFindMode: vi.fn(),
  setToolbarPanel: vi.fn(),
  semanticResults: [],
  getLabelForId: vi.fn(() => 'label'),
  communityServerUrl: '',
};

// useTaxonomyStore is called both with and without a selector in this component
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (selector?: any) => selector ? selector(mockTaxStore) : mockTaxStore,
}));

const mockCommentStore: Record<string, any> = {
  commentsFile: null,
  loadComments: vi.fn(),
  unloadComments: vi.fn(),
  sidebarOpen: false,
  toggleSidebar: vi.fn(),
};

// useCommentStore is called without a selector in this component
vi.mock('../../hooks/useCommentStore', () => ({
  useCommentStore: (selector?: any) => selector ? selector(mockCommentStore) : mockCommentStore,
}));

vi.mock('../../hooks/useCommunityStore', () => ({
  useCommunityStore: (selector: any) => selector({ submitItem: vi.fn() }),
}));

vi.mock('../../hooks/useAuthStatus', () => ({
  useUserProfile: () => null,
}));

vi.mock('../../hooks/useTierInfo', () => ({
  useTierInfo: () => ({ tier: null, usage: null, loading: false, refresh: vi.fn() }),
}));

// ── Bridge / side-effect mocks ────────────────────────────────

vi.mock('@bridge', () => ({
  api: {
    onDiagnosticsPopoutClosed: vi.fn(() => vi.fn()),
    onReExtractClaims: vi.fn(() => vi.fn()),
    clipboardWriteText: vi.fn(),
    openExternal: vi.fn(),
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../../lib/flightRecorderInit', () => ({
  triggerManualDump: vi.fn(),
}));

vi.mock('@lib/debate/coverageTracker', () => ({
  computeCoverageMap: vi.fn(() => null),
  computeStrengthWeightedCoverage: vi.fn(() => null),
}));

// ── External child-component mocks ────────────────────────────

vi.mock('../debate/DebateSourceViewer', () => ({
  DebateSourceViewer: () => <div data-testid="source-viewer" />,
}));
vi.mock('../analysis/NeutralEvaluationPanel', () => ({
  NeutralEvaluationPanel: () => <div data-testid="eval-panel" />,
}));
vi.mock('../analysis/ParameterHistoryPanel', () => ({
  ParameterHistoryPanel: () => <div data-testid="param-history" />,
}));
vi.mock('../chat/CommentCreationPopover', () => ({
  CommentCreationPopover: () => <div data-testid="comment-popover" />,
}));
vi.mock('../chat/CommentSidebar', () => ({
  CommentSidebar: () => <div data-testid="comment-sidebar" />,
}));
vi.mock('../shared/UsernamePromptDialog', () => ({
  UsernamePromptDialog: () => <div data-testid="username-dialog" />,
}));
vi.mock('../shared/CommunityShareBanner', () => ({
  CommunityShareBanner: () => <div data-testid="share-banner" />,
}));
vi.mock('../debate-diagnostics/chat', () => ({
  DiagnosticsChatSidebar: () => <div data-testid="diag-chat" />,
}));

// ── Debate type mocks ─────────────────────────────────────────

vi.mock('../../types/debate', () => ({
  POVER_INFO: {
    accelerationist: { label: 'Accelerationist', color: 'var(--color-acc)' },
    safetyist: { label: 'Safetyist', color: 'var(--color-saf)' },
    skeptic: { label: 'Skeptic', color: 'var(--color-skp)' },
  },
  DEBATE_AUDIENCES: [
    { id: 'policymaker', label: 'Policymaker' },
    { id: 'technical', label: 'Technical' },
  ],
}));

vi.mock('@lib/debate/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/debate/types')>();
  return { ...actual };
});

// ── Local workspace sub-component mocks ──────────────────────

vi.mock('./StatementCard', () => ({
  StatementCard: ({ entry }: any) => <div data-testid={`statement-${entry.id}`} />,
  ProbingCard: ({ entry }: any) => <div data-testid={`probing-${entry.id}`} />,
  FactCheckCard: ({ entry }: any) => <div data-testid={`factcheck-${entry.id}`} />,
  EntryDeleteControls: () => null,
  HighlightedText: ({ text }: any) => <span>{text}</span>,
}));
vi.mock('./DebateActionBar', () => ({
  PhaseProgressBar: () => <div data-testid="phase-progress" />,
  SessionPhaseStepper: () => <div data-testid="session-stepper" />,
  ProgressIndicator: () => <div data-testid="progress-indicator" />,
  DebaterToggles: () => <div data-testid="debater-toggles" />,
  DebateActions: () => <div data-testid="debate-actions" />,
}));
vi.mock('./ClarificationPanel', () => ({
  ClarificationActions: () => <div data-testid="clarification-actions" />,
  ClaimsEditor: () => <div data-testid="claims-editor" />,
  RefinedTopicEditor: () => <div data-testid="refined-topic-editor" />,
  TopicScoreComparison: () => <div data-testid="topic-score-comparison" />,
}));
vi.mock('./OpeningPanel', () => ({
  OpeningActions: () => <div data-testid="opening-actions" />,
}));
vi.mock('./TaxonomyRefs', () => ({
  CoverageBadge: () => <div data-testid="coverage-badge" />,
}));
vi.mock('./utils', () => ({
  speakerLabel: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  speakerColor: () => 'red',
  nodeIdToTab: () => ({ tab: 'beliefs', colorVar: 'var(--color-acc)' }),
  focusMainWindowNode: vi.fn(),
  countOccurrences: () => 0,
  ADAPTIVE_PHASES: ['confrontation', 'argumentation', 'concluding'],
  ADAPTIVE_PHASE_LABELS: { confrontation: 'Confrontation', argumentation: 'Argumentation', concluding: 'Concluding' },
  ADAPTIVE_PHASE_COLORS: { confrontation: '#ef4444', argumentation: '#f59e0b', concluding: '#22c55e' },
}));

// ── Test fixture ──────────────────────────────────────────────

function makeDebate(overrides: Partial<any> = {}): any {
  return {
    id: 'test-debate-1',
    title: 'Test Debate',
    topic: { original: 'AI regulation', final: 'Should AI be regulated?', refined: null },
    phase: 'debate',
    transcript: [],
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    audience: 'policymaker',
    debate_model: 'gemini-2.5-flash',
    created_at: '2026-06-15T12:00:00Z',
    updated_at: '2026-06-15T12:30:00Z',
    context_summaries: [],
    source_type: 'topic',
    adaptive_staging: null,
    argument_network: null,
    document_analysis: null,
    neutral_evaluations: null,
    ...overrides,
  };
}

afterEach(() => { vi.clearAllMocks(); });

// ── Loading and empty states ──────────────────────────────────

describe('loading and empty states', () => {
  it('renders loading text when debateLoading is true', () => {
    mockStore.debateLoading = true;
    mockStore.activeDebate = null;
    render(<DebateWorkspace />);
    expect(screen.getByText('Loading debate...')).toBeInTheDocument();
  });

  it('does not render the workspace toolbar while loading', () => {
    mockStore.debateLoading = true;
    mockStore.activeDebate = null;
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-toolbar')).toBeNull();
  });

  it('renders no-debate message when activeDebate is null and not loading', () => {
    mockStore.debateLoading = false;
    mockStore.activeDebate = null;
    render(<DebateWorkspace />);
    expect(screen.getByText('No debate selected')).toBeInTheDocument();
  });

  it('does not render the workspace toolbar when no debate is selected', () => {
    mockStore.debateLoading = false;
    mockStore.activeDebate = null;
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-toolbar')).toBeNull();
  });
});

// ── Toolbar ───────────────────────────────────────────────────

describe('toolbar', () => {
  beforeEach(() => {
    mockStore.debateLoading = false;
    mockStore.diagnosticsEnabled = false;
    mockStore.activeDebate = makeDebate();
  });

  it('renders Diagnostics button', () => {
    render(<DebateWorkspace />);
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
  });

  it('shows diagnostics ON label when diagnosticsEnabled is true', () => {
    mockStore.diagnosticsEnabled = true;
    render(<DebateWorkspace />);
    expect(screen.getByText('Diagnostics ON')).toBeInTheDocument();
  });

  it('renders Comments button', () => {
    render(<DebateWorkspace />);
    expect(screen.getByText('Comments (0)')).toBeInTheDocument();
  });

  it('renders tier pills — Brief, Med, Detail', () => {
    render(<DebateWorkspace />);
    expect(screen.getByText('Brief')).toBeInTheDocument();
    expect(screen.getByText('Med')).toBeInTheDocument();
    expect(screen.getByText('Detail')).toBeInTheDocument();
  });

  it('renders all six tier pills', () => {
    const { container } = render(<DebateWorkspace />);
    const pills = container.querySelectorAll('.debate-tier-pill');
    expect(pills.length).toBe(6);
  });

  it('marks the active tier pill', () => {
    mockStore.responseLength = 'brief';
    const { container } = render(<DebateWorkspace />);
    const activePills = container.querySelectorAll('.debate-tier-pill-active');
    expect(activePills.length).toBe(1);
    expect(activePills[0].textContent).toBe('Brief');
  });

  it('does not render Export button when onExport prop is not provided', () => {
    render(<DebateWorkspace />);
    expect(screen.queryByTitle('Export debate')).toBeNull();
  });

  it('shows exportStatus text when exportStatus prop is provided', () => {
    render(<DebateWorkspace exportStatus="Exporting..." />);
    expect(screen.getByText('Exporting...')).toBeInTheDocument();
  });
});

// ── Phase routing ─────────────────────────────────────────────

describe('phase routing', () => {
  beforeEach(() => {
    mockStore.debateLoading = false;
    mockStore.debateGenerating = null;
  });

  it('shows "Topic Refinement" phase title for clarification phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'clarification' });
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-phase-indicator')?.textContent).toBe('Topic Refinement');
  });

  it('shows "Opening Statements" phase title for opening phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'opening' });
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-phase-indicator')?.textContent).toBe('Opening Statements');
  });

  it('shows "Debate" phase title for debate phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'debate' });
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-phase-indicator')?.textContent).toBe('Debate');
  });

  it('shows "Debate Closed" phase title for closed phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'closed' });
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-phase-indicator')?.textContent).toBe('Debate Closed');
  });

  it('shows "Setting up..." phase title for setup phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'setup' });
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-phase-indicator')?.textContent).toBe('Setting up...');
  });

  it('renders ClarificationActions in clarification phase when no substantive transcript entries', () => {
    mockStore.activeDebate = makeDebate({ phase: 'clarification', transcript: [] });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('clarification-actions')).toBeInTheDocument();
  });

  it('does not render ClarificationActions when transcript already has opening entries', () => {
    mockStore.activeDebate = makeDebate({
      phase: 'clarification',
      transcript: [{ id: 'e1', type: 'opening', content: 'Hello', speaker: 'accelerationist' }],
    });
    render(<DebateWorkspace />);
    expect(screen.queryByTestId('clarification-actions')).toBeNull();
  });

  it('renders OpeningActions in opening phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'opening' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('opening-actions')).toBeInTheDocument();
  });

  it('renders DebateActions in debate phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'debate' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('debate-actions')).toBeInTheDocument();
  });

  it('renders DebateActions in closed phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'closed' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('debate-actions')).toBeInTheDocument();
  });

  it('renders DebaterToggles in debate phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'debate' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('debater-toggles')).toBeInTheDocument();
  });

  it('renders DebaterToggles in opening phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'opening' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('debater-toggles')).toBeInTheDocument();
  });

  it('does not render DebaterToggles in clarification phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'clarification' });
    render(<DebateWorkspace />);
    expect(screen.queryByTestId('debater-toggles')).toBeNull();
  });

  it('does not render ClarificationActions or OpeningActions in debate phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'debate' });
    render(<DebateWorkspace />);
    expect(screen.queryByTestId('clarification-actions')).toBeNull();
    expect(screen.queryByTestId('opening-actions')).toBeNull();
  });

  it('renders SessionPhaseStepper during debate phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'debate' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('session-stepper')).toBeInTheDocument();
  });

  it('hides SessionPhaseStepper when debate is closed (t/1027)', () => {
    mockStore.activeDebate = makeDebate({ phase: 'closed' });
    render(<DebateWorkspace />);
    expect(screen.queryByTestId('session-stepper')).toBeNull();
  });

  it('hides PhaseProgressBar when debate is closed (t/1027)', () => {
    mockStore.activeDebate = makeDebate({
      phase: 'closed',
      adaptive_staging: { enabled: true, current_phase: 'concluding', phase_progress: 1, rounds_in_phase: 4, approaching_transition: false },
    });
    render(<DebateWorkspace />);
    expect(screen.queryByTestId('phase-progress')).toBeNull();
  });

  it('renders PhaseProgressBar during active debate with adaptive staging', () => {
    mockStore.activeDebate = makeDebate({
      phase: 'debate',
      adaptive_staging: { enabled: true, current_phase: 'confrontation', phase_progress: 0.5, rounds_in_phase: 3, approaching_transition: false },
    });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('phase-progress')).toBeInTheDocument();
  });

  it('renders ClaimsEditor in edit-claims phase', () => {
    mockStore.activeDebate = makeDebate({ phase: 'edit-claims' });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('claims-editor')).toBeInTheDocument();
  });
});

// ── Transcript rendering ──────────────────────────────────────

describe('transcript rendering', () => {
  beforeEach(() => {
    mockStore.debateLoading = false;
    mockStore.debateGenerating = null;
  });

  it('renders StatementCard for statement-type entries', () => {
    mockStore.activeDebate = makeDebate({
      transcript: [
        { id: 'e1', type: 'statement', content: 'Hello world', speaker: 'accelerationist' },
      ],
    });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('statement-e1')).toBeInTheDocument();
  });

  it('renders ProbingCard for probing-type entries', () => {
    mockStore.activeDebate = makeDebate({
      transcript: [
        { id: 'e2', type: 'probing', content: 'Probing question', speaker: 'moderator' },
      ],
    });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('probing-e2')).toBeInTheDocument();
  });

  it('renders FactCheckCard for fact-check-type entries', () => {
    mockStore.activeDebate = makeDebate({
      transcript: [
        { id: 'e3', type: 'fact-check', content: 'Fact check result', speaker: 'moderator' },
      ],
    });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('factcheck-e3')).toBeInTheDocument();
  });

  it('skips clarification-type entries — renders no card for them', () => {
    mockStore.activeDebate = makeDebate({
      phase: 'debate',
      transcript: [
        { id: 'e4', type: 'clarification', content: 'Clarification content', speaker: 'moderator' },
      ],
    });
    render(<DebateWorkspace />);
    expect(screen.queryByTestId('statement-e4')).toBeNull();
    expect(screen.queryByTestId('probing-e4')).toBeNull();
    expect(screen.queryByTestId('factcheck-e4')).toBeNull();
  });

  it('renders multiple mixed entry types', () => {
    mockStore.activeDebate = makeDebate({
      transcript: [
        { id: 'e1', type: 'statement', content: 'Statement', speaker: 'accelerationist' },
        { id: 'e2', type: 'probing', content: 'Probing', speaker: 'moderator' },
        { id: 'e3', type: 'fact-check', content: 'Fact', speaker: 'moderator' },
        { id: 'e4', type: 'clarification', content: 'Clarification', speaker: 'moderator' },
      ],
    });
    render(<DebateWorkspace />);
    expect(screen.getByTestId('statement-e1')).toBeInTheDocument();
    expect(screen.getByTestId('probing-e2')).toBeInTheDocument();
    expect(screen.getByTestId('factcheck-e3')).toBeInTheDocument();
    expect(screen.queryByTestId('statement-e4')).toBeNull();
  });

  it('shows generating indicator with speaker label and "thinking..." when debateGenerating is set', () => {
    mockStore.activeDebate = makeDebate();
    mockStore.debateGenerating = 'accelerationist';
    render(<DebateWorkspace />);
    // speakerLabel mock: 'accelerationist' → 'Accelerationist'
    expect(screen.getByText('Accelerationist')).toBeInTheDocument();
    expect(screen.getByText('thinking...')).toBeInTheDocument();
  });

  it('does not show generating indicator when debateGenerating is null', () => {
    mockStore.activeDebate = makeDebate();
    mockStore.debateGenerating = null;
    render(<DebateWorkspace />);
    expect(screen.queryByText('thinking...')).toBeNull();
  });

  it('shows empty transcript message when transcript is empty and not generating', () => {
    mockStore.activeDebate = makeDebate({ transcript: [] });
    mockStore.debateGenerating = null;
    render(<DebateWorkspace />);
    expect(screen.getByText(/The debate is ready to begin/)).toBeInTheDocument();
  });

  it('does not show empty transcript message when generating is set', () => {
    mockStore.activeDebate = makeDebate({ transcript: [] });
    mockStore.debateGenerating = 'safetyist';
    render(<DebateWorkspace />);
    expect(screen.queryByText(/The debate is ready to begin/)).toBeNull();
  });
});

// ── Export ────────────────────────────────────────────────────

describe('export', () => {
  beforeEach(() => {
    mockStore.debateLoading = false;
    mockStore.activeDebate = makeDebate();
  });

  it('renders Export button when onExport prop is provided', () => {
    render(<DebateWorkspace onExport={vi.fn()} />);
    expect(screen.getByTitle('Export debate')).toBeInTheDocument();
  });

  it('does not render Export button when onExport is not provided', () => {
    render(<DebateWorkspace />);
    expect(screen.queryByTitle('Export debate')).toBeNull();
  });

  it('shows format menu with all five options on Export click', () => {
    render(<DebateWorkspace onExport={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Export debate'));
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.getByText('Markdown')).toBeInTheDocument();
    expect(screen.getByText('Plain Text')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Package (ZIP)')).toBeInTheDocument();
  });

  it('calls onExport with "json" when JSON format is selected', () => {
    const onExport = vi.fn();
    render(<DebateWorkspace onExport={onExport} />);
    fireEvent.click(screen.getByTitle('Export debate'));
    fireEvent.click(screen.getByText('JSON'));
    expect(onExport).toHaveBeenCalledWith('json');
  });

  it('calls onExport with "markdown" when Markdown format is selected', () => {
    const onExport = vi.fn();
    render(<DebateWorkspace onExport={onExport} />);
    fireEvent.click(screen.getByTitle('Export debate'));
    fireEvent.click(screen.getByText('Markdown'));
    expect(onExport).toHaveBeenCalledWith('markdown');
  });

  it('calls onExport with "pdf" when PDF format is selected', () => {
    const onExport = vi.fn();
    render(<DebateWorkspace onExport={onExport} />);
    fireEvent.click(screen.getByTitle('Export debate'));
    fireEvent.click(screen.getByText('PDF'));
    expect(onExport).toHaveBeenCalledWith('pdf');
  });

  it('closes the format menu after a format is selected', () => {
    const onExport = vi.fn();
    const { container } = render(<DebateWorkspace onExport={onExport} />);
    fireEvent.click(screen.getByTitle('Export debate'));
    expect(container.querySelector('.export-format-menu')).toBeTruthy();
    fireEvent.click(screen.getByText('Markdown'));
    expect(container.querySelector('.export-format-menu')).toBeNull();
  });
});

// ── Find bar ──────────────────────────────────────────────────

describe('find bar', () => {
  beforeEach(() => {
    mockStore.debateLoading = false;
    mockStore.activeDebate = makeDebate();
  });

  it('does not show find bar on initial render', () => {
    const { container } = render(<DebateWorkspace />);
    expect(container.querySelector('.debate-find-bar')).toBeNull();
  });

  it('opens find bar on Ctrl+F', () => {
    const { container } = render(<DebateWorkspace />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    expect(container.querySelector('.debate-find-bar')).toBeTruthy();
  });

  it('opens find bar on Meta+F (macOS)', () => {
    const { container } = render(<DebateWorkspace />);
    fireEvent.keyDown(document, { key: 'f', metaKey: true });
    expect(container.querySelector('.debate-find-bar')).toBeTruthy();
  });

  it('does not open find bar on plain F key', () => {
    const { container } = render(<DebateWorkspace />);
    fireEvent.keyDown(document, { key: 'f' });
    expect(container.querySelector('.debate-find-bar')).toBeNull();
  });

  it('closes find bar on Escape key pressed inside the input', () => {
    const { container } = render(<DebateWorkspace />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const input = container.querySelector('.debate-find-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('.debate-find-bar')).toBeNull();
  });

  it('closes find bar by clicking the close button', () => {
    const { container } = render(<DebateWorkspace />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const closeBtn = container.querySelector('.debate-find-close') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(container.querySelector('.debate-find-bar')).toBeNull();
  });

  it('renders find input with placeholder text', () => {
    render(<DebateWorkspace />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const input = screen.getByPlaceholderText('Find in debate…');
    expect(input).toBeInTheDocument();
  });
});
