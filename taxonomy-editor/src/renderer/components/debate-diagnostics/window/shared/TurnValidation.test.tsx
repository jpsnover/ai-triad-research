// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  classifyHintTarget,
  CITE_HINT_RE,
  HINT_TARGET_STYLE,
  sanitizeTurnValidation,
  TurnValidationSection,
  TurnValidationAttemptRow,
} from './TurnValidation';
import type { TurnValidationTrail, TurnAttempt, TurnValidation as TurnValidationType, TurnValidationDimensions } from '../../../../types/debate';

vi.mock('../../../../utils/humanizeSpeakers', () => ({
  humanizeSpeakerIds: (s: string) => s,
}));

// --- Factories ---

function makeDims(overrides: Partial<TurnValidationDimensions> = {}): TurnValidationDimensions {
  return {
    schema: { pass: true, issues: [] },
    grounding: { pass: true, issues: [] },
    advancement: { pass: true, signals: [] },
    clarifies: { pass: true, signals: [] },
    ...overrides,
  };
}

function makeValidation(overrides: Partial<TurnValidationType> = {}): TurnValidationType {
  return {
    outcome: 'pass',
    process_reward: 0.85,
    dimensions: makeDims(),
    repairHints: [],
    clarifies_taxonomy: [],
    judge_used: false,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<TurnAttempt> = {}): TurnAttempt {
  return {
    attempt: 0,
    model: 'gemini-2.5-flash',
    prompt_delta: '',
    raw_response: '{}',
    response_time_ms: 1200,
    validation: makeValidation(),
    ...overrides,
  };
}

function makeTrail(overrides: Partial<TurnValidationTrail> = {}): TurnValidationTrail {
  return {
    final: makeValidation(),
    attempts: [makeAttempt()],
    ...overrides,
  };
}

// --- classifyHintTarget ---

describe('classifyHintTarget', () => {
  it('classifies taxonomy_refs filler hints as cite', () => {
    expect(classifyHintTarget('taxonomy_refs contains filler entries')).toBe('cite');
  });

  it('classifies taxonomy_refs too-short hints as cite', () => {
    expect(classifyHintTarget('taxonomy_refs too-short for grounding')).toBe('cite');
  });

  it('classifies taxonomy_refs relevance hints as cite', () => {
    expect(classifyHintTarget('taxonomy_refs have low relevance')).toBe('cite');
  });

  it('classifies "No new taxonomy_refs" as cite', () => {
    expect(classifyHintTarget('No new taxonomy_refs added')).toBe('cite');
  });

  it('classifies "Unknown taxonomy node" as cite', () => {
    expect(classifyHintTarget('Unknown taxonomy node saf-B-099')).toBe('cite');
  });

  it('classifies "Unknown policy_refs" as cite', () => {
    expect(classifyHintTarget('Unknown policy_refs pol-xyz')).toBe('cite');
  });

  it('classifies "grounding_confidence" hints as cite', () => {
    expect(classifyHintTarget('grounding_confidence below threshold')).toBe('cite');
  });

  it('classifies hints mentioning move_types as draft', () => {
    expect(classifyHintTarget('move_types should include rebut')).toBe('draft');
  });

  it('classifies hints mentioning my_claims as draft', () => {
    expect(classifyHintTarget('my_claims array is empty')).toBe('draft');
  });

  it('classifies hints mentioning paragraph as draft', () => {
    expect(classifyHintTarget('paragraph is too short')).toBe('draft');
  });

  it('classifies hints mentioning statement as draft', () => {
    expect(classifyHintTarget('statement lacks substance')).toBe('draft');
  });

  it('classifies hints mentioning hedge as draft', () => {
    expect(classifyHintTarget('hedge language detected')).toBe('draft');
  });

  it('classifies hints mentioning commitment as draft', () => {
    expect(classifyHintTarget('commitment not tracked')).toBe('draft');
  });

  it('classifies hints mentioning compressed_thesis as draft', () => {
    expect(classifyHintTarget('compressed_thesis missing')).toBe('draft');
  });

  it('classifies generic short observations as judge', () => {
    expect(classifyHintTarget('argument lacks depth')).toBe('judge');
  });

  it('classifies vague quality remarks as judge', () => {
    expect(classifyHintTarget('weak reasoning throughout')).toBe('judge');
  });

  it('is case-insensitive', () => {
    expect(classifyHintTarget('TAXONOMY_REFS FILLER entries')).toBe('cite');
    expect(classifyHintTarget('MOVE_TYPES should be corrected')).toBe('draft');
  });
});

describe('CITE_HINT_RE', () => {
  it('matches taxonomy_refs filler pattern', () => {
    expect(CITE_HINT_RE.test('taxonomy_refs contain filler')).toBe(true);
  });

  it('matches grounding_confidence', () => {
    expect(CITE_HINT_RE.test('grounding_confidence is 0.2')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(CITE_HINT_RE.test('paragraph too short')).toBe(false);
  });
});

describe('HINT_TARGET_STYLE', () => {
  it('has entries for draft, cite, and judge', () => {
    expect(HINT_TARGET_STYLE.draft.label).toBe('DRAFT');
    expect(HINT_TARGET_STYLE.cite.label).toBe('CITE');
    expect(HINT_TARGET_STYLE.judge.label).toBe('QUALITY');
  });
});

// --- sanitizeTurnValidation ---

describe('sanitizeTurnValidation', () => {
  it('returns trail unchanged when all fields are present', () => {
    const trail = makeTrail();
    const result = sanitizeTurnValidation(trail);
    expect(result.final.process_reward).toBe(0.85);
    expect(result.final.dimensions.schema.pass).toBe(true);
    expect(result.attempts).toHaveLength(1);
  });

  it('defaults process_reward to 0 when missing', () => {
    const trail = makeTrail({
      final: makeValidation({ process_reward: undefined as unknown as number }),
    });
    const result = sanitizeTurnValidation(trail);
    expect(result.final.process_reward).toBe(0);
  });

  it('defaults repairHints to empty array when missing', () => {
    const trail = makeTrail({
      final: makeValidation({ repairHints: undefined as unknown as string[] }),
    });
    const result = sanitizeTurnValidation(trail);
    expect(result.final.repairHints).toEqual([]);
  });

  it('defaults attempts to empty array when missing', () => {
    const trail = makeTrail({ attempts: undefined as unknown as TurnAttempt[] });
    const result = sanitizeTurnValidation(trail);
    expect(result.attempts).toEqual([]);
  });

  it('defaults all dimension fields when dimensions is missing', () => {
    const trail = makeTrail({
      final: makeValidation({ dimensions: undefined as unknown as TurnValidationDimensions }),
    });
    const result = sanitizeTurnValidation(trail);
    expect(result.final.dimensions.schema).toEqual({ pass: true, issues: [] });
    expect(result.final.dimensions.grounding).toEqual({ pass: true, issues: [] });
    expect(result.final.dimensions.advancement).toEqual({ pass: true, signals: [] });
    expect(result.final.dimensions.clarifies).toEqual({ pass: true, signals: [] });
  });

  it('defaults individual missing dimensions', () => {
    const trail = makeTrail({
      final: makeValidation({
        dimensions: { schema: { pass: false, issues: ['bad'] } } as TurnValidationDimensions,
      }),
    });
    const result = sanitizeTurnValidation(trail);
    expect(result.final.dimensions.schema).toEqual({ pass: false, issues: ['bad'] });
    expect(result.final.dimensions.grounding).toEqual({ pass: true, issues: [] });
  });
});

// --- TurnValidationSection ---

describe('TurnValidationSection', () => {
  it('renders the outcome badge', () => {
    render(<TurnValidationSection trail={makeTrail()} />);
    // PASS appears in both the section header and the attempt row
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the final score', () => {
    render(<TurnValidationSection trail={makeTrail({ final: makeValidation({ process_reward: 0.73 }) })} />);
    // Score appears in header and attempt row
    expect(screen.getAllByText('0.73').length).toBeGreaterThanOrEqual(1);
  });

  it('shows attempt count', () => {
    render(<TurnValidationSection trail={makeTrail({ attempts: [makeAttempt(), makeAttempt({ attempt: 1 })] })} />);
    expect(screen.getByText('2 attempts')).toBeInTheDocument();
  });

  it('uses singular "attempt" for single attempt', () => {
    render(<TurnValidationSection trail={makeTrail()} />);
    expect(screen.getByText('1 attempt')).toBeInTheDocument();
  });

  it('shows judge model when judge_used is true', () => {
    render(<TurnValidationSection trail={makeTrail({
      final: makeValidation({ judge_used: true, judge_model: 'claude-3-opus' }),
    })} />);
    expect(screen.getByText('judge: claude-3-opus')).toBeInTheDocument();
  });

  it('does not show judge model when judge_used is false', () => {
    render(<TurnValidationSection trail={makeTrail()} />);
    expect(screen.queryByText(/judge:/)).not.toBeInTheDocument();
  });

  it('shows best-attempt indicator when last attempt regressed', () => {
    const trail = makeTrail({
      final: makeValidation({ process_reward: 0.90 }),
      attempts: [
        makeAttempt({ attempt: 0, validation: makeValidation({ process_reward: 0.90 }) }),
        makeAttempt({ attempt: 1, validation: makeValidation({ process_reward: 0.60 }) }),
      ],
    });
    render(<TurnValidationSection trail={trail} />);
    expect(screen.getByText(/Used attempt 0/)).toBeInTheDocument();
    expect(screen.getByText(/last attempt regressed/)).toBeInTheDocument();
  });

  it('does not show best-attempt indicator when last attempt is best', () => {
    const trail = makeTrail({
      attempts: [
        makeAttempt({ attempt: 0, validation: makeValidation({ process_reward: 0.60 }) }),
        makeAttempt({ attempt: 1, validation: makeValidation({ process_reward: 0.90 }) }),
      ],
    });
    render(<TurnValidationSection trail={trail} />);
    expect(screen.queryByText(/Used attempt/)).not.toBeInTheDocument();
  });

  it('renders repair hints with target labels when present', () => {
    render(<TurnValidationSection trail={makeTrail({
      final: makeValidation({ repairHints: ['move_types should include rebut'] }),
    })} />);
    expect(screen.getByText('Caveats (final)')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('move_types should include rebut')).toBeInTheDocument();
  });

  it('renders all attempt rows', () => {
    const trail = makeTrail({
      attempts: [makeAttempt({ attempt: 0 }), makeAttempt({ attempt: 1 })],
    });
    render(<TurnValidationSection trail={trail} />);
    expect(screen.getByText('Attempt 0 (original)')).toBeInTheDocument();
    expect(screen.getByText('Attempt 1')).toBeInTheDocument();
  });
});

// --- TurnValidationAttemptRow ---

describe('TurnValidationAttemptRow', () => {
  it('renders collapsed by default with summary info', () => {
    render(<TurnValidationAttemptRow a={makeAttempt()} />);
    expect(screen.getByText('Attempt 0 (original)')).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('score 0.85')).toBeInTheDocument();
  });

  it('shows response time in seconds', () => {
    render(<TurnValidationAttemptRow a={makeAttempt({ response_time_ms: 3456 })} />);
    expect(screen.getByText('3.5s')).toBeInTheDocument();
  });

  it('does not label non-zero attempts as original', () => {
    render(<TurnValidationAttemptRow a={makeAttempt({ attempt: 2 })} />);
    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
    expect(screen.queryByText(/original/)).not.toBeInTheDocument();
  });

  it('shows judge model when judge_used is true', () => {
    render(<TurnValidationAttemptRow a={makeAttempt({
      validation: makeValidation({ judge_used: true, judge_model: 'gpt-4o' }),
    })} />);
    expect(screen.getByText('judge: gpt-4o')).toBeInTheDocument();
  });

  it('expands on click to show score breakdown', async () => {
    const user = userEvent.setup();
    render(<TurnValidationAttemptRow a={makeAttempt()} />);
    expect(screen.queryByText('Score breakdown')).not.toBeInTheDocument();
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.getByText('Score breakdown')).toBeInTheDocument();
  });

  it('shows caveats when repair hints exist and expanded', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({
      validation: makeValidation({ repairHints: ['Unknown taxonomy node saf-B-001'] }),
    });
    render(<TurnValidationAttemptRow a={attempt} />);
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.getByText('Caveats')).toBeInTheDocument();
    expect(screen.getByText('CITE')).toBeInTheDocument();
  });

  it('shows taxonomy clarification hints when expanded', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({
      validation: makeValidation({
        clarifies_taxonomy: [
          { action: 'add_node', node_id: 'saf-B-100', rationale: 'Missing safety claim', label: undefined as unknown as string },
        ],
      }),
    });
    render(<TurnValidationAttemptRow a={attempt} />);
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.getByText('Taxonomy clarification hints')).toBeInTheDocument();
    expect(screen.getByText('add_node')).toBeInTheDocument();
  });

  it('shows hint effectiveness when present and expanded', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({
      hint_effectiveness: [
        {
          hint_text: 'fix grounding', category: 'structural', source: 'stage_a',
          specificity: 'concrete', resolution: 'fixed',
          pre_score: 0.40, post_score: 0.80, score_delta: 0.40,
        },
      ],
    });
    render(<TurnValidationAttemptRow a={attempt} />);
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.getByText('Hint Effectiveness')).toBeInTheDocument();
    expect(screen.getByText('Fixed: 1')).toBeInTheDocument();
  });

  it('shows prompt delta when present and expanded', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({ prompt_delta: 'Added grounding requirements' });
    render(<TurnValidationAttemptRow a={attempt} />);
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.getByText('Repair prompt delta')).toBeInTheDocument();
    expect(screen.getByText('Added grounding requirements')).toBeInTheDocument();
  });

  it('collapses on second click', async () => {
    const user = userEvent.setup();
    render(<TurnValidationAttemptRow a={makeAttempt()} />);
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.getByText('Score breakdown')).toBeInTheDocument();
    await user.click(screen.getByText('Attempt 0 (original)'));
    expect(screen.queryByText('Score breakdown')).not.toBeInTheDocument();
  });
});
