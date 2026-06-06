// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressIndicator, PhaseProgressBar, DebaterToggles } from './DebateActionBar';

// ── Mocks ────────────────────────────────────────────────────

const mockStore: Record<string, any> = {
  activeDebate: null,
  debateGenerating: null,
  debateActivity: null,
  debateProgress: null,
  debateError: null,
  togglePover: vi.fn(),
  askQuestion: vi.fn(),
  crossRespond: vi.fn(),
  requestSynthesis: vi.fn(),
  requestProbingQuestions: vi.fn(),
  requestReflections: vi.fn(),
  audience: 'policymaker',
  setAudience: vi.fn(),
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

vi.mock('@lib/debate/types', () => ({
  AI_POVERS: ['accelerationist', 'safetyist', 'skeptic'],
}));

vi.mock('./utils', () => ({
  speakerLabel: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  ADAPTIVE_PHASES: ['confrontation', 'argumentation', 'concluding'],
  ADAPTIVE_PHASE_LABELS: {
    confrontation: 'Confrontation',
    argumentation: 'Argumentation',
    concluding: 'Concluding',
  },
  ADAPTIVE_PHASE_COLORS: {
    confrontation: '#ef4444',
    argumentation: '#f59e0b',
    concluding: '#22c55e',
  },
}));

vi.mock('../HarvestDialog', () => ({
  HarvestDialog: () => <div data-testid="harvest-dialog" />,
}));
vi.mock('../ReflectionsPanel', () => ({
  ReflectionsPanel: () => <div data-testid="reflections-panel" />,
}));
vi.mock('../NewsReportModal', () => ({
  NewsReportModal: () => <div data-testid="news-report-modal" />,
}));

afterEach(() => { vi.clearAllMocks(); });

// ── ProgressIndicator ───────────────────────────────────────

describe('ProgressIndicator', () => {
  it('renders nothing when no activity', () => {
    mockStore.debateActivity = null;
    mockStore.debateProgress = null;
    const { container } = render(<ProgressIndicator />);
    expect(container.innerHTML).toBe('');
  });

  it('renders activity text', () => {
    mockStore.debateActivity = 'Generating response...';
    mockStore.debateProgress = null;
    render(<ProgressIndicator />);
    expect(screen.getByText('Generating response...')).toBeInTheDocument();
  });

  it('shows retry info when retrying', () => {
    mockStore.debateActivity = 'Calling AI...';
    mockStore.debateProgress = { attempt: 2, maxRetries: 3, phase: 'retry', backoffSeconds: 5 };
    render(<ProgressIndicator />);
    expect(screen.getByText(/Retry 2\/3/)).toBeInTheDocument();
    expect(screen.getByText(/waiting 5s/)).toBeInTheDocument();
  });

  it('shows limit message when present', () => {
    mockStore.debateActivity = 'Calling AI...';
    mockStore.debateProgress = { attempt: 1, maxRetries: 3, phase: 'active', limitMessage: 'Rate limited' };
    render(<ProgressIndicator />);
    expect(screen.getByText('Rate limited')).toBeInTheDocument();
  });
});

// ── PhaseProgressBar ────────────────────────────────────────

describe('PhaseProgressBar', () => {
  it('renders all three phase segments', () => {
    const { container } = render(
      <PhaseProgressBar
        currentPhase="confrontation"
        phaseProgress={0.5}
        roundsInPhase={3}
        approachingTransition={false}
      />
    );
    expect(container.querySelectorAll('.adaptive-phase-segment').length).toBe(3);
  });

  it('marks current phase as active', () => {
    const { container } = render(
      <PhaseProgressBar
        currentPhase="argumentation"
        phaseProgress={0.3}
        roundsInPhase={2}
        approachingTransition={false}
      />
    );
    const segments = container.querySelectorAll('.adaptive-phase-segment');
    expect(segments[0]?.classList.contains('completed')).toBe(true);
    expect(segments[1]?.classList.contains('active')).toBe(true);
  });

  it('shows transition hint when approaching', () => {
    render(
      <PhaseProgressBar
        currentPhase="confrontation"
        phaseProgress={0.9}
        roundsInPhase={5}
        approachingTransition={true}
      />
    );
    expect(screen.getByText('Approaching transition')).toBeInTheDocument();
  });

  it('shows rationale when provided', () => {
    render(
      <PhaseProgressBar
        currentPhase="concluding"
        phaseProgress={0.6}
        roundsInPhase={4}
        approachingTransition={false}
        rationale="Arguments are converging"
      />
    );
    expect(screen.getByText('Arguments are converging')).toBeInTheDocument();
  });
});

// ── DebaterToggles ──────────────────────────────────────────

describe('DebaterToggles', () => {
  it('renders nothing when no active debate', () => {
    mockStore.activeDebate = null;
    const { container } = render(<DebaterToggles />);
    expect(container.innerHTML).toBe('');
  });

  it('renders toggle pills for all AI povers', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist', 'safetyist'],
      transcript: [],
    };
    mockStore.debateGenerating = null;
    render(<DebaterToggles />);
    expect(screen.getByText(/Accelerationist/)).toBeInTheDocument();
    expect(screen.getByText(/Safetyist/)).toBeInTheDocument();
    expect(screen.getByText(/Skeptic/)).toBeInTheDocument();
  });

  it('shows active styling for included povers', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist', 'safetyist'],
      transcript: [],
    };
    mockStore.debateGenerating = null;
    const { container } = render(<DebaterToggles />);
    const pills = container.querySelectorAll('.debate-debater-pill');
    const accPill = Array.from(pills).find(p => p.textContent?.includes('Accelerationist'));
    const skpPill = Array.from(pills).find(p => p.textContent?.includes('Skeptic'));
    expect(accPill?.classList.contains('debate-debater-pill-active')).toBe(true);
    expect(skpPill?.classList.contains('debate-debater-pill-inactive')).toBe(true);
  });

  it('disables pills when generating', () => {
    mockStore.activeDebate = {
      active_povers: ['accelerationist'],
      transcript: [],
    };
    mockStore.debateGenerating = 'accelerationist';
    const { container } = render(<DebaterToggles />);
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => expect(btn.disabled).toBe(true));
  });
});
