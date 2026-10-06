// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3988 — soul threading tests for shared-helpers and stageValidation.
// Verifies: tagged soul overrides POVER_INFO; untagged path is byte-identical to baseline.

import { describe, it, expect } from 'vitest';
import {
  getCharacterBlock,
  otherDebaters,
  formatDoctrinalBoundaries,
} from '../prompts/shared-helpers.js';
import { checkBoundaryConcession } from '../turnValidator/stageValidation.js';
import { POVER_INFO } from '../poverInfo.js';
import type { PovInfo } from '../types.js';

const ACC_BASE = POVER_INFO.accelerationist;
const SAF_BASE = POVER_INFO.safetyist;

const TAGGED_ACC: PovInfo = {
  ...ACC_BASE,
  voice: {
    ...ACC_BASE.voice,
    disposition: 'TAG-DISPOSITION: relentless pragmatist',
    style: 'TAG-STYLE: direct and quantified',
  },
  anti_patterns: ['TAG-ANTI-hedging'],
  value_hierarchy: ['TAG-GROWTH', 'TAG-SPEED'],
  boundaries: {
    hardcoded: ['never advocate for indefinite moratoria'],
    softcoded: ['prefer quantitative framing'],
  },
};

const TAGGED_SAF: PovInfo = {
  ...SAF_BASE,
  voice: {
    ...SAF_BASE.voice,
    disposition: 'TAG-SAF-DISPOSITION: cautious institutionalist',
  },
};

describe('soul threading — getCharacterBlock', () => {
  it('without soul: output is byte-identical to baseline', () => {
    const base = getCharacterBlock('accelerationist');
    expect(getCharacterBlock('accelerationist', undefined)).toBe(base);
  });

  it('with soul: uses soul voice, not POVER_INFO voice', () => {
    const result = getCharacterBlock('accelerationist', TAGGED_ACC);
    expect(result).toContain('TAG-DISPOSITION');
    expect(result).not.toContain(ACC_BASE.voice.disposition);
  });
});

describe('soul threading — otherDebaters', () => {
  it('without opponentSouls: output is byte-identical to baseline', () => {
    const base = otherDebaters('Accelerationist');
    expect(otherDebaters('Accelerationist', undefined)).toBe(base);
  });

  it('with opponentSouls: uses tagged disposition for specified opponent', () => {
    const result = otherDebaters('Accelerationist', { safetyist: TAGGED_SAF });
    expect(result).toContain('TAG-SAF-DISPOSITION');
    const baseDisposition = SAF_BASE.voice.disposition.split('—')[0]?.trim() ?? '';
    expect(result).not.toContain(baseDisposition);
  });
});

describe('soul threading — formatDoctrinalBoundaries', () => {
  it('without soul: output is byte-identical to baseline', () => {
    const base = formatDoctrinalBoundaries('accelerationist');
    expect(formatDoctrinalBoundaries('accelerationist', undefined)).toBe(base);
  });

  it('with soul: uses soul boundaries, not POVER_INFO boundaries', () => {
    const result = formatDoctrinalBoundaries('accelerationist', TAGGED_ACC);
    expect(result).toContain('never advocate for indefinite moratoria');
  });
});

describe('soul threading — checkBoundaryConcession', () => {
  it('without soul: reads boundaries from POVER_INFO[speaker]', () => {
    const result = checkBoundaryConcession('safetyist', [], 'test statement');
    expect(result).toHaveProperty('hasConcession');
    expect(result).toHaveProperty('boundaryType');
  });

  it('with soul that has empty boundaries: never detects hardcoded concession', () => {
    const soulNoBoundaries: PovInfo = {
      ...SAF_BASE,
      boundaries: { hardcoded: [], softcoded: [] },
    };
    const result = checkBoundaryConcession(
      'safetyist',
      ['Concession'],
      'we fully concede this point',
      soulNoBoundaries,
    );
    expect(result.boundaryType).not.toBe('hardcoded');
  });
});
