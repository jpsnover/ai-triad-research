// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  normalizeJudgeResult,
  validFlags,
  needsCoherenceRewrite,
  buildCoherenceViolationsText,
  type CoherenceJudgeResult,
} from '../coherenceCheck.js';

const unflagged = { flagged: false, span_a: '', span_b: '', why: '' };

const allClear: CoherenceJudgeResult = {
  check1: unflagged,
  check2: unflagged,
  check3: unflagged,
};

const withFlag: CoherenceJudgeResult = {
  check1: { flagged: true, span_a: 'costs nothing', span_b: 'imposes real cost', why: 'closes by negating earlier premise' },
  check2: unflagged,
  check3: unflagged,
};

const withEmptySpans: CoherenceJudgeResult = {
  check1: { flagged: true, span_a: '', span_b: '', why: 'model forgot to quote spans' },
  check2: unflagged,
  check3: unflagged,
};

describe('normalizeJudgeResult', () => {
  it('assigns canonical check_ids', () => {
    const checks = normalizeJudgeResult(allClear);
    expect(checks.map(c => c.check_id)).toEqual(['thesis_solution', 'mechanism_scope', 'co_asserted_tension']);
  });

  it('spreads entry fields onto each check', () => {
    const checks = normalizeJudgeResult(withFlag);
    expect(checks[0].flagged).toBe(true);
    expect(checks[0].span_a).toBe('costs nothing');
    expect(checks[1].flagged).toBe(false);
  });
});

describe('validFlags', () => {
  it('returns empty when nothing is flagged', () => {
    expect(validFlags(normalizeJudgeResult(allClear))).toHaveLength(0);
  });

  it('returns the flag when flagged=true and both spans non-empty', () => {
    const flags = validFlags(normalizeJudgeResult(withFlag));
    expect(flags).toHaveLength(1);
    expect(flags[0].check_id).toBe('thesis_solution');
  });

  it('rejects flags with empty spans (structural guard)', () => {
    expect(validFlags(normalizeJudgeResult(withEmptySpans))).toHaveLength(0);
  });

  it('rejects flags with whitespace-only spans', () => {
    const checks = normalizeJudgeResult({
      check1: { flagged: true, span_a: '   ', span_b: 'some text', why: 'a reason' },
      check2: unflagged,
      check3: unflagged,
    });
    expect(validFlags(checks)).toHaveLength(0);
  });
});

describe('needsCoherenceRewrite', () => {
  it('returns false when no valid flags', () => {
    expect(needsCoherenceRewrite(normalizeJudgeResult(allClear))).toBe(false);
  });

  it('returns true when at least one valid flag', () => {
    expect(needsCoherenceRewrite(normalizeJudgeResult(withFlag))).toBe(true);
  });
});

describe('buildCoherenceViolationsText', () => {
  it('returns empty string when no valid flags', () => {
    expect(buildCoherenceViolationsText(normalizeJudgeResult(allClear))).toBe('');
  });

  it('formats a single flag with check_id, why, and both spans', () => {
    const text = buildCoherenceViolationsText(normalizeJudgeResult(withFlag));
    expect(text).toContain('[thesis_solution]');
    expect(text).toContain('closes by negating earlier premise');
    expect(text).toContain('"costs nothing"');
    expect(text).toContain('"imposes real cost"');
  });

  it('separates multiple flags with a blank line', () => {
    const multi: CoherenceJudgeResult = {
      check1: { flagged: true, span_a: 'span A1', span_b: 'span B1', why: 'reason 1' },
      check2: unflagged,
      check3: { flagged: true, span_a: 'span A3', span_b: 'span B3', why: 'reason 3' },
    };
    const text = buildCoherenceViolationsText(normalizeJudgeResult(multi));
    expect(text).toContain('[thesis_solution]');
    expect(text).toContain('[co_asserted_tension]');
    expect(text.split('\n\n')).toHaveLength(2);
  });
});
