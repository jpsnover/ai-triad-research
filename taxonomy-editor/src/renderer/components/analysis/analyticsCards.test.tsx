// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('./analyticsCards.css', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let calResp: any;
let calReject = false;
vi.mock('@bridge', () => ({
  api: { getCalibrationLog: () => calReject ? Promise.reject(new Error('cal fail')) : Promise.resolve(calResp) },
}));

const { DebateHealthCard } = await import('./DebateHealthCard');
const { AICostCard } = await import('./AICostCard');
const { DebateFunnelChart } = await import('./DebateFunnelChart');

describe('DebateHealthCard (t/891)', () => {
  beforeEach(() => { calReject = false; calResp = { entries: [], validationReport: null }; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows "No debates yet" when there is no debate or calibration data', async () => {
    render(<DebateHealthCard eventTypes={undefined} />);
    await waitFor(() => expect(screen.getByText('No debates yet')).toBeInTheDocument());
  });

  it('shows completion rate and calibration-sourced quality', async () => {
    calResp = { entries: [{ crux_addressed_ratio: 0.8 }, { crux_addressed_ratio: 0.9 }], validationReport: null };
    const { container } = render(<DebateHealthCard eventTypes={{ 'debate.complete': 8, 'debate.abandon': 2 }} />);
    expect(screen.getByText('80% completed')).toBeInTheDocument();
    expect(screen.getByText('8 done · 2 abandoned')).toBeInTheDocument();
    await waitFor(() => expect(container.textContent).toContain('avg quality 0.85'));
  });
});

describe('AICostCard (t/892)', () => {
  it('shows "No AI calls" when there is no spend', () => {
    render(<AICostCard aiCost={undefined} />);
    expect(screen.getByText('No AI calls in this period')).toBeInTheDocument();
  });

  it('shows cost, tokens, per-debate, and per-model breakdown', () => {
    const { container } = render(
      <AICostCard
        debateCount={5}
        aiCost={{
          calls: 10, tokensIn: 1000, tokensOut: 500, costUsd: 0.1234,
          byModel: {
            gemini: { calls: 6, tokensIn: 600, tokensOut: 300, costUsd: 0.08 },
            claude: { calls: 4, tokensIn: 400, tokensOut: 200, costUsd: 0.0434 },
          },
        }}
      />,
    );
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
    expect(container.textContent).toContain('1.5k tokens');
    expect(container.textContent).toContain('$0.0247 / debate'); // 0.1234 / 5
    expect(container.textContent).toContain('gemini: $0.0800');
    expect(container.textContent).toContain('claude: $0.0434');
  });
});

describe('DebateFunnelChart (t/893)', () => {
  it('shows an empty state with no debate data', () => {
    render(<DebateFunnelChart eventTypes={undefined} />);
    expect(screen.getByText('No debate data yet')).toBeInTheDocument();
  });

  it('renders stages and marks un-instrumented stages as not yet tracked', () => {
    const { container } = render(
      <DebateFunnelChart eventTypes={{ 'debate.complete': 5, 'debate.abandon': 5, 'node.create': 3, 'node.edit': 2 }} />,
    );
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // Started = complete + abandon = 10; Taxonomy changes = 3 + 2 = 5
    expect(container.textContent).toContain('10');
    // Turns/Extractions have no events yet → flagged, not a misleading 0
    expect(screen.getAllByText('(not yet tracked)').length).toBe(2);
    expect(container.textContent).toContain('—');
  });

  it('populates all stages and flags the biggest drop-off once events exist', () => {
    const { container } = render(
      <DebateFunnelChart eventTypes={{
        'debate.start': 10, 'debate.turn': 40, 'debate.extraction': 6,
        'node.create': 3, 'node.edit': 1, 'debate.complete': 7,
      }} />,
    );
    // All five stages now instrumented — nothing flagged as pending.
    expect(screen.queryByText('(not yet tracked)')).toBeNull();
    // Largest consecutive drop is Turns (40) → Extractions (6).
    expect(container.textContent).toContain('Turns completed → Extractions made');
  });
});
