// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { FABRICATED_LEDE_GUARD } from './opedGuards.js';

// ── Positive arm: guard fires on known fabricated dated-event phrases ─────────

describe('FABRICATED_LEDE_GUARD — positive arm (fabrication detected)', () => {
  const FABRICATED_CASES = [
    'This week, as federal regulators draft new rules requiring multi-month pre-clearance audits…',
    'Next week, the Senate will take a pending vote on the newly proposed AI regulation.',
    'Yesterday, the agency released a newly drafted rule on frontier model oversight.',
    'The pending ruling from the appeals court has shaken the industry.',
    'The newly proposed regulation would require pre-clearance from an independent board.',
    'Pre-clearance requirements are now under discussion in Brussels.',
    'Regulators are drafting new regulations that would require pre-clearance for every model release.',
    'A newly drafted rule from the FTC landed this week, catching developers off guard.',
    "Next week's pending vote in the Senate threatens to reshape the field overnight.",
    "Yesterday's announcement of a pre-clearance mandate sent shockwaves through Silicon Valley.",
    'The pending ruling, expected this week, would mandate pre-clearance of any frontier system.',
    'Newly proposed rules would require developers to seek pre-clearance 90 days before release.',
  ];

  FABRICATED_CASES.forEach((text, i) => {
    it(`case ${i + 1}: detects fabricated dated-event marker`, () => {
      expect(FABRICATED_LEDE_GUARD.test(text)).toBe(true);
    });
  });
});

// ── Negative arm (N≥10): guard fires 0 times on timeless stakes framing ──────

describe('FABRICATED_LEDE_GUARD — guard-regression (mock): 0 fires on timeless empty-hook ledes', () => {
  const TIMELESS_LEDES = [
    'The question of who controls artificial intelligence has never been more consequential.',
    'A structural tension at the heart of the field — speed versus safety — demands a clear answer.',
    'Machines now write code, diagnose disease, and advise judges. The field has never moved faster.',
    'Every technology that reshaped civilization arrived before the rules to govern it. AI is no different.',
    'The last time a single technology threatened to compress decades of change into years, we called it the internet.',
    'For decades, the promise of artificial general intelligence lived in science fiction. It is no longer fiction.',
    'The real risk of advanced AI is not a robot rebellion. It is a slow, invisible transfer of power.',
    'Acceleration is not a policy. It is a bet — and right now, the house always wins.',
    'Safety and speed are not opposites. The engineers who believe otherwise have never shipped a bridge.',
    'We have been here before: a technology too powerful to ignore, too complex to regulate, and too profitable to slow.',
    'When a single model can pass the bar exam, write legislation, and simulate a pandemic, governance cannot wait.',
    'The optimists say the risks are theoretical. The pessimists say they are already here. Both are right.',
  ];

  TIMELESS_LEDES.forEach((text, i) => {
    it(`case ${i + 1}: does not flag timeless framing`, () => {
      expect(FABRICATED_LEDE_GUARD.test(text)).toBe(false);
    });
  });
});
