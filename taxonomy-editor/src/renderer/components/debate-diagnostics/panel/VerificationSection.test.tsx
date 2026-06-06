// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerificationSection } from './VerificationSection';
import type { VerificationSectionProps } from './VerificationSection';
import type { ArgumentNetworkNode } from '../../../types/debate';

// ── Mock @bridge (used transitively by helpers.tsx) ──────────────────────────
vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn() },
}));

// ── Mock helpers (CollapsibleSection) ────────────────────────────────────────
vi.mock('./helpers', () => ({
  CollapsibleSection: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
  }) => (
    <div data-testid="collapsible">
      <div data-testid="collapsible-title">{title}</div>
      <div>{children}</div>
    </div>
  ),
  speakerLabel: (speaker: string) => speaker,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type TranscriptEntry = VerificationSectionProps['transcript'][number];

function makeFactCheck(
  verdict: string,
  checkedText: string,
  opts: {
    explanation?: string;
    isAuto?: boolean;
    webSearchUsed?: boolean;
    webSearchQueries?: string[];
    webSearchCitations?: Array<{ url?: string; title?: string }>;
    targetAnId?: string;
  } = {},
): TranscriptEntry {
  return {
    type: 'fact-check',
    content: '',
    metadata: {
      fact_check: {
        verdict,
        checked_text: checkedText,
        explanation: opts.explanation ?? `Explanation for ${checkedText}`,
        target_an_id: opts.targetAnId ?? (opts.isAuto ? 'acc-B-001' : undefined),
        web_search_used: opts.webSearchUsed ?? false,
        web_search_queries: opts.webSearchQueries ?? [],
        web_search_citations: opts.webSearchCitations ?? [],
      },
    },
  };
}

function makePreciseBelief(
  id: string,
  verificationStatus?: ArgumentNetworkNode['verification_status'],
): ArgumentNetworkNode {
  return {
    id,
    text: `Precise belief ${id}`,
    speaker: 'accelerationist',
    source_entry_id: `entry-${id}`,
    taxonomy_refs: [],
    turn_number: 1,
    bdi_category: 'belief',
    specificity: 'precise',
    verification_status: verificationStatus,
  };
}

const NO_AN_NODES: ArgumentNetworkNode[] = [];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VerificationSection — hidden when empty', () => {
  it('renders nothing when transcript has no fact-checks and no precise beliefs', () => {
    const { container } = render(
      <VerificationSection transcript={[]} anNodes={NO_AN_NODES} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when transcript entries are non-fact-check types', () => {
    const transcript: TranscriptEntry[] = [
      { type: 'message', content: 'Hello' },
      { type: 'system', content: 'Debate started' },
    ];
    const { container } = render(
      <VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('VerificationSection — renders when data is present', () => {
  it('renders the section title', () => {
    const transcript = [makeFactCheck('verified', 'AI is advancing rapidly')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByTestId('collapsible-title')).toHaveTextContent('Fact-Check Verification');
  });

  it('shows total check count', () => {
    const transcript = [
      makeFactCheck('verified', 'claim 1'),
      makeFactCheck('disputed', 'claim 2'),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText(/Total checks:/)).toBeInTheDocument();
    expect(screen.getByText(/2 \(0 auto, 2 user\)/)).toBeInTheDocument();
  });

  it('counts auto and user checks separately', () => {
    const transcript = [
      makeFactCheck('verified', 'auto claim', { isAuto: true, targetAnId: 'acc-B-001' }),
      makeFactCheck('supported', 'user claim'),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    // "2 (1 auto, 1 user)"
    expect(screen.getByText(/1 auto, 1 user/)).toBeInTheDocument();
  });
});

describe('VerificationSection — verdict badges', () => {
  it('renders a verdict badge for each unique verdict', () => {
    const transcript = [
      makeFactCheck('verified', 'claim A'),
      makeFactCheck('disputed', 'claim B'),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    // Both verdicts should appear in the badge row
    const verifiedBadge = screen.getAllByText(/verified/);
    expect(verifiedBadge.length).toBeGreaterThanOrEqual(1);
    const disputedBadge = screen.getAllByText(/disputed/);
    expect(disputedBadge.length).toBeGreaterThanOrEqual(1);
  });

  it('applies green background color to "verified" verdict badge', () => {
    const transcript = [makeFactCheck('verified', 'a verified claim')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    // The verdict badge in the summary row has style background set to VERDICT_COLORS['verified']
    const badges = screen.getAllByText(/verified/);
    // At least one badge element should have the green color applied
    const greenBadge = badges.find(
      el => (el as HTMLElement).style?.background === 'rgb(22, 163, 74)',
    );
    expect(greenBadge).toBeDefined();
  });

  it('applies red background color to "disputed" verdict badge', () => {
    const transcript = [makeFactCheck('disputed', 'a disputed claim')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    const badges = screen.getAllByText(/disputed/);
    const redBadge = badges.find(
      el => (el as HTMLElement).style?.background === 'rgb(220, 38, 38)',
    );
    expect(redBadge).toBeDefined();
  });

  it('applies amber color to "unverifiable" verdict badge', () => {
    const transcript = [makeFactCheck('unverifiable', 'an unverifiable claim')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    const badges = screen.getAllByText(/unverifiable/);
    const amberBadge = badges.find(
      el => (el as HTMLElement).style?.background === 'rgb(161, 98, 7)',
    );
    expect(amberBadge).toBeDefined();
  });

  it('applies grey color to "pending" verdict badge', () => {
    const transcript = [makeFactCheck('pending', 'a pending claim')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    const badges = screen.getAllByText(/pending/);
    const greyBadge = badges.find(
      el => (el as HTMLElement).style?.background === 'rgb(107, 114, 128)',
    );
    expect(greyBadge).toBeDefined();
  });
});

describe('VerificationSection — detail rows', () => {
  it('renders each fact-check as a clickable row', () => {
    const transcript = [
      makeFactCheck('verified', 'claim one'),
      makeFactCheck('disputed', 'claim two'),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText('claim one')).toBeInTheDocument();
    expect(screen.getByText('claim two')).toBeInTheDocument();
  });

  it('truncates checked text longer than 80 characters', () => {
    const longText = 'A'.repeat(90);
    const transcript = [makeFactCheck('verified', longText)];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    // Should be truncated to 77 chars + '...'
    expect(screen.getByText(`${'A'.repeat(77)}...`)).toBeInTheDocument();
  });

  it('does not truncate checked text at or under 80 characters', () => {
    const text = 'A'.repeat(80);
    const transcript = [makeFactCheck('verified', text)];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows "auto" label for auto fact-checks', () => {
    const transcript = [makeFactCheck('verified', 'auto checked', { isAuto: true, targetAnId: 'acc-B-001' })];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText('auto')).toBeInTheDocument();
  });

  it('shows "user" label for user fact-checks', () => {
    const transcript = [makeFactCheck('verified', 'user checked')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('shows "· web" suffix when webSearchUsed is true', () => {
    const transcript = [makeFactCheck('verified', 'web claim', { webSearchUsed: true })];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText(/· web/)).toBeInTheDocument();
  });
});

describe('VerificationSection — expand detail row', () => {
  it('does not show explanation before row is clicked', () => {
    const explanation = 'This is the detailed explanation';
    const transcript = [makeFactCheck('verified', 'some claim', { explanation })];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();
  });

  it('shows explanation after row is clicked', async () => {
    const explanation = 'This is the detailed explanation';
    const transcript = [makeFactCheck('verified', 'some claim', { explanation })];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    await userEvent.click(screen.getByText('some claim'));
    expect(screen.getByText(explanation)).toBeInTheDocument();
  });

  it('collapses an open row when clicked again', async () => {
    const explanation = 'Detailed explanation text';
    const transcript = [makeFactCheck('verified', 'some claim', { explanation })];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    await userEvent.click(screen.getByText('some claim'));
    expect(screen.getByText(explanation)).toBeInTheDocument();
    await userEvent.click(screen.getByText('some claim'));
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();
  });

  it('shows target AN node id in expanded row when targetAnId is set', async () => {
    const transcript = [
      makeFactCheck('verified', 'auto claim', { isAuto: true, targetAnId: 'acc-B-007' }),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    await userEvent.click(screen.getByText('auto claim'));
    expect(screen.getByText(/acc-B-007/)).toBeInTheDocument();
  });

  it('shows web search queries in expanded row when provided', async () => {
    const transcript = [
      makeFactCheck('verified', 'web claim', {
        webSearchUsed: true,
        webSearchQueries: ['query one', 'query two'],
      }),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    await userEvent.click(screen.getByText('web claim'));
    expect(screen.getByText(/query one/)).toBeInTheDocument();
  });

  it('shows citations in expanded row when provided', async () => {
    const transcript = [
      makeFactCheck('verified', 'cited claim', {
        webSearchUsed: true,
        webSearchCitations: [{ title: 'Nature Article', url: 'https://example.com/1' }],
      }),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    await userEvent.click(screen.getByText('cited claim'));
    expect(screen.getByText('Nature Article')).toBeInTheDocument();
  });
});

describe('VerificationSection — precise-belief coverage', () => {
  it('shows coverage bar when precise beliefs exist', () => {
    const belief = makePreciseBelief('acc-B-001', 'verified');
    const transcript = [makeFactCheck('verified', 'some claim')];
    render(<VerificationSection transcript={transcript} anNodes={[belief]} />);
    expect(screen.getByText(/Precise-belief coverage:/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 1/)).toBeInTheDocument();
  });

  it('counts only non-pending verifications as verified', () => {
    const verified = makePreciseBelief('acc-B-001', 'verified');
    const pending  = makePreciseBelief('acc-B-002', 'pending');
    const unset    = makePreciseBelief('acc-B-003', undefined);
    const transcript = [makeFactCheck('verified', 'claim')];
    render(
      <VerificationSection transcript={transcript} anNodes={[verified, pending, unset]} />,
    );
    // 1 verified out of 3 precise beliefs
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
  });

  it('shows "No fact-checks recorded" message when precise beliefs exist but no checks', () => {
    const belief = makePreciseBelief('acc-B-001');
    render(<VerificationSection transcript={[]} anNodes={[belief]} />);
    expect(screen.getByText(/No fact-checks recorded yet/)).toBeInTheDocument();
  });

  it('does not show coverage bar when no precise beliefs exist', () => {
    const transcript = [makeFactCheck('verified', 'some claim')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.queryByText(/Precise-belief coverage:/)).not.toBeInTheDocument();
  });
});

describe('parseFactCheckMeta — field extraction (via rendered output)', () => {
  it('extracts verdict from nested fact_check key', () => {
    // metadata.fact_check.verdict path
    const entry: TranscriptEntry = {
      type: 'fact-check',
      content: '',
      metadata: {
        fact_check: { verdict: 'supported', checked_text: 'nested claim', explanation: 'ok' },
      },
    };
    render(<VerificationSection transcript={[entry]} anNodes={NO_AN_NODES} />);
    // "supported" verdict badge should appear
    expect(screen.getAllByText(/supported/).length).toBeGreaterThanOrEqual(1);
  });

  it('extracts verdict from flat metadata when fact_check key is absent', () => {
    // metadata itself is the fact_check object (flat path)
    const entry: TranscriptEntry = {
      type: 'fact-check',
      content: '',
      metadata: { verdict: 'false', checked_text: 'flat claim', explanation: 'nope' },
    };
    render(<VerificationSection transcript={[entry]} anNodes={NO_AN_NODES} />);
    expect(screen.getAllByText(/false/).length).toBeGreaterThanOrEqual(1);
  });

  it('defaults to "unknown" verdict when neither verdict path is present', () => {
    const entry: TranscriptEntry = {
      type: 'fact-check',
      content: '',
      metadata: {},
    };
    render(<VerificationSection transcript={[entry]} anNodes={NO_AN_NODES} />);
    expect(screen.getAllByText(/unknown/).length).toBeGreaterThanOrEqual(1);
  });

  it('sets isAuto=true when target_an_id is present', () => {
    const transcript = [
      makeFactCheck('verified', 'auto claim', { targetAnId: 'saf-B-003' }),
    ];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText('auto')).toBeInTheDocument();
  });

  it('sets isAuto=false when target_an_id is absent', () => {
    const transcript = [makeFactCheck('verified', 'user claim')];
    render(<VerificationSection transcript={transcript} anNodes={NO_AN_NODES} />);
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('handles missing web_search_queries gracefully (defaults to empty array)', async () => {
    const entry: TranscriptEntry = {
      type: 'fact-check',
      content: '',
      metadata: { verdict: 'verified', checked_text: 'no queries', explanation: 'ok' },
    };
    render(<VerificationSection transcript={[entry]} anNodes={NO_AN_NODES} />);
    await userEvent.click(screen.getByText('no queries'));
    // No queries section should appear — no crash
    expect(screen.queryByText(/Queries:/)).not.toBeInTheDocument();
  });
});
