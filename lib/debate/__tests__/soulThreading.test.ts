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
import { buildStageInput } from '../turnPipeline/runTurn-stages.js';
import type { TurnPipelineInput } from '../turnPipeline/types.js';
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

const BASE_TURN_INPUT: TurnPipelineInput = {
  label: 'Accelerationist',
  pov: 'accelerationist',
  personality: ACC_BASE.personality,
  topic: 'Test topic',
  taxonomyContext: '',
  commitmentContext: '',
  establishedPoints: '',
  edgeContext: '',
  concessionHint: '',
  recentTranscript: '',
  focusPoint: '',
  addressing: '',
  phase: 'opening',
  priorMoves: [],
  turnsSinceLastConcession: 0,
  priorRefs: [],
  availablePovNodeIds: [],
  model: 'test-model',
};

describe('soul threading — buildStageInput pipeline forwarding', () => {
  it('without soul: soul and opponentSouls are undefined in stage input', () => {
    const result = buildStageInput(BASE_TURN_INPUT);
    expect(result.soul).toBeUndefined();
    expect(result.opponentSouls).toBeUndefined();
  });

  it('with soul: soul is forwarded to stage input', () => {
    const result = buildStageInput({ ...BASE_TURN_INPUT, soul: TAGGED_ACC });
    expect(result.soul).toBe(TAGGED_ACC);
  });

  it('with opponentSouls: opponentSouls is forwarded to stage input', () => {
    const opponents = { safetyist: TAGGED_SAF };
    const result = buildStageInput({ ...BASE_TURN_INPUT, opponentSouls: opponents });
    expect(result.opponentSouls).toBe(opponents);
  });

  it('forwarded soul reaches getCharacterBlock output', () => {
    const stageInput = buildStageInput({ ...BASE_TURN_INPUT, soul: TAGGED_ACC });
    const charBlock = getCharacterBlock(stageInput.pov, stageInput.soul);
    expect(charBlock).toContain('TAG-DISPOSITION');
    expect(charBlock).not.toContain(ACC_BASE.voice.disposition);
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
