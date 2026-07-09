// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdaptiveStagingTab } from './AdaptiveStagingTab';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist', color: 'var(--color-acc)' },
      safetyist:       { label: 'Safetyist', pov: 'safetyist', color: 'var(--color-saf)' },
      skeptic:         { label: 'Skeptic', pov: 'skeptic', color: 'var(--color-skp)' },
    },
  };
});
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({ default: { label: 'Accelerationist' } }));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json',       () => ({ default: { label: 'Safetyist' } }));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json',         () => ({ default: { label: 'Skeptic' } }));
vi.mock('@bridge', () => ({
  api: {
    clipboardWriteText: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBaseDebate() {
  return {
    id: 'test-debate-0000',
    topic: { scope: {} },
    transcript: [],
    phase: 'rounds',
    diagnostics: { entries: {} },
    argument_network: undefined,
    commitments: undefined,
  } as any;
}

function makeDiagnostics() {
  return {
    phases: [
      { phase: 'confrontation', rounds: [1, 2, 3], exit_reason: 'saturation_reached' },
      { phase: 'argumentation', rounds: [4, 5],    exit_reason: 'convergence_detected' },
    ],
    regressions: [],
    total_predicate_evaluations: 12,
    confidence_deferrals: 2,
    vetoes_fired: 1,
    forces_fired: 0,
    network_size_peak: 8,
    gc_events: [],
    signal_telemetry: [
      {
        round: 1,
        phase: 'confrontation',
        signals: { topic_coherence: 0.2 },
        composite: { saturation_score: 0.45, convergence_score: 0.3 },
        confidence: { extraction: 0.8, stability: 0.7, global: 0.75 },
        predicate_result: { action: 'stay', reason: 'not saturated', veto_active: false, force_active: false, confidence_deferred: false },
        network_size: 3,
        elapsed_ms: 120,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdaptiveStagingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "no data" message when adaptive_staging_diagnostics is undefined', () => {
    const debate = makeBaseDebate();
    render(<AdaptiveStagingTab debate={debate} />);

    expect(screen.getByText(/No adaptive staging data available/i)).toBeInTheDocument();
  });

  it('renders phase timeline when diagnostic data exists', () => {
    const debate = {
      ...makeBaseDebate(),
      adaptive_staging_diagnostics: makeDiagnostics(),
    };

    render(<AdaptiveStagingTab debate={debate} />);

    // Section heading
    expect(screen.getByText('Phase Timeline')).toBeInTheDocument();

    // Both phases should appear in the table
    expect(screen.getByText('confrontation')).toBeInTheDocument();
    expect(screen.getByText('argumentation')).toBeInTheDocument();

    // Exit reasons
    expect(screen.getByText('saturation_reached')).toBeInTheDocument();
    expect(screen.getByText('convergence_detected')).toBeInTheDocument();
  });

  it('shows download button for signals JSON', () => {
    const debate = {
      ...makeBaseDebate(),
      adaptive_staging_diagnostics: makeDiagnostics(),
    };

    render(<AdaptiveStagingTab debate={debate} />);

    const downloadBtn = screen.getByRole('button', { name: /Download Signals JSON/i });
    expect(downloadBtn).toBeInTheDocument();
  });

  it('renders summary stat cards with correct values', () => {
    const diag = makeDiagnostics();
    const debate = { ...makeBaseDebate(), adaptive_staging_diagnostics: diag };

    render(<AdaptiveStagingTab debate={debate} />);

    // Stat card labels
    expect(screen.getByText('Predicate evals')).toBeInTheDocument();
    expect(screen.getByText('Confidence deferrals')).toBeInTheDocument();
    expect(screen.getByText('Vetoes')).toBeInTheDocument();
    expect(screen.getByText('Forces')).toBeInTheDocument();

    // Verify each stat card value by locating the label then checking its
    // sibling (the value div sits immediately before the label div in the DOM).
    const predsLabel = screen.getByText('Predicate evals');
    expect(predsLabel.previousSibling?.textContent).toBe('12');

    const defLabel = screen.getByText('Confidence deferrals');
    expect(defLabel.previousSibling?.textContent).toBe('2');

    const vetoLabel = screen.getByText('Vetoes');
    expect(vetoLabel.previousSibling?.textContent).toBe('1');
  });
});
