// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3514 — steelman badge, transcript callout, and the debate-wide panel.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SteelmanBadge, StatementSteelmans, SteelmansPanel, steelmanCount } from './Steelman';
import type { DebateSession } from '../../types/debate';

type AnNode = NonNullable<DebateSession['argument_network']>['nodes'][number];

const node = (over: Partial<AnNode>): AnNode => ({
  id: 'AN-26', text: 'ASML and TSMC can gate foundational silicon at the lithography level.', speaker: 'accelerationist',
  source_entry_id: 'e1', taxonomy_refs: [], turn_number: 4, ...over,
} as AnNode);

const debateWith = (nodes: AnNode[]): DebateSession => ({ id: 'd1', transcript: [], argument_network: { nodes, edges: [] } } as unknown as DebateSession);

describe('SteelmanBadge', () => {
  it('shows the target and a faithful verdict', () => {
    render(<SteelmanBadge node={node({ steelman_of: 'safetyist', steelman_check: { verdict: 'faithful', max_entailment: 0.82 } })} />);
    const badge = screen.getByText(/Steelman of Safetyist/);
    expect(badge).toHaveClass('steelman-faithful');
    expect(badge).toHaveAttribute('title', expect.stringContaining('0.82'));
  });

  it('marks a diverging steelman', () => {
    render(<SteelmanBadge node={node({ steelman_of: 'safetyist', steelman_check: { verdict: 'diverges', max_entailment: 0.12 } })} />);
    expect(screen.getByText(/Steelman of Safetyist/)).toHaveClass('steelman-diverges');
  });

  it('handles pre-fix label values and debates with no verdict', () => {
    render(<SteelmanBadge node={node({ steelman_of: 'Skeptic' })} />);
    const badge = screen.getByText(/Steelman of Skeptic/);
    expect(badge).toHaveClass('steelman-unchecked');
    expect(badge).toHaveAttribute('title', expect.stringContaining('predates'));
  });

  it('renders nothing for junk targets', () => {
    const { container } = render(<SteelmanBadge node={node({ steelman_of: 'AN-18' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StatementSteelmans (transcript callout)', () => {
  it('shows the steelman text, verdict, and what the target actually said', () => {
    const d = debateWith([node({ steelman_of: 'safetyist', steelman_check: { verdict: 'diverges', max_entailment: 0.31, best_match: 'Foundries are a natural chokepoint.' } })]);
    render(<StatementSteelmans entryId="e1" debate={d} />);
    expect(screen.getByText('Steelman of the Safetyist')).toBeInTheDocument();
    expect(screen.getByText(/misrepresents them/)).toBeInTheDocument();
    expect(screen.getByText(/lithography level/)).toBeInTheDocument();
    expect(screen.getByText(/Closest thing the Safetyist actually said/)).toBeInTheDocument();
    expect(screen.getByText('Foundries are a natural chokepoint.')).toBeInTheDocument();
  });

  it('renders nothing for an entry without steelmans', () => {
    const { container } = render(<StatementSteelmans entryId="e9" debate={debateWith([node({ steelman_of: 'safetyist' })])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains an unchecked steelman', () => {
    render(<StatementSteelmans entryId="e1" debate={debateWith([node({ steelman_of: 'safetyist', steelman_check: { verdict: 'unchecked', reason: 'Target has no recorded assertions yet' } })])} />);
    expect(screen.getByText('Target has no recorded assertions yet')).toBeInTheDocument();
  });
});

describe('SteelmansPanel (diagnostics tab)', () => {
  it('summarizes verdicts and lists every steelman with its author', () => {
    const d = debateWith([
      node({ id: 'AN-1', steelman_of: 'safetyist', steelman_check: { verdict: 'faithful', max_entailment: 0.8 } }),
      node({ id: 'AN-2', speaker: 'safetyist', steelman_of: 'skeptic', steelman_check: { verdict: 'diverges', max_entailment: 0.2 } }),
      node({ id: 'AN-3', steelman_of: 'Skeptic' }),
      node({ id: 'AN-4', steelman_of: 'AN-18' }), // junk: excluded
    ]);
    render(<SteelmansPanel debate={d} />);
    expect(screen.getByText(/3 steelmans/)).toBeInTheDocument();
    expect(screen.getByText('1 faithful')).toBeInTheDocument();
    expect(screen.getByText('1 misrepresent the target')).toBeInTheDocument();
    expect(screen.getByText("Safetyist's steelman of the Skeptic")).toBeInTheDocument();
    expect(steelmanCount(d)).toBe(3);
  });

  it('shows an empty state', () => {
    render(<SteelmansPanel debate={debateWith([])} />);
    expect(screen.getByText(/No steelmans were recorded/)).toBeInTheDocument();
  });
});
