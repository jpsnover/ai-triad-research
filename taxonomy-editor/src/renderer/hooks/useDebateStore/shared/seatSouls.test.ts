// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3975: seat souls come from the REAL tag souls (tagSoulRegistry's glob over lib/debate/soul-docs),
// not a mock, so a path or naming drift between the registry and the soul files fails here (t/3989).

import { describe, it, expect } from 'vitest';
import { POVER_INFO } from '@lib/debate/poverInfo';
import skepticCritical from '@lib/debate/soul-docs/skeptic.critical.soul.json';
import { seatSouls, seatTagSelection } from './seatSouls';

const TAGGED = { seat_tags: { skeptic: { pov_tag: 'critical', tag_mode: 'scope' as const } } };
const TAG_DISPOSITION = skepticCritical.voice.disposition;

describe('seatSouls (t/3975)', () => {
  it('the fixture is a real difference: the tag soul and the base soul disagree on disposition', () => {
    expect(TAG_DISPOSITION).not.toBe(POVER_INFO.skeptic.voice.disposition);
  });

  it('untagged session: the base soul, and no opponentSouls (prompts stay byte-identical)', () => {
    for (const session of [undefined, null, {}, { seat_tags: {} }]) {
      const s = seatSouls(session, 'skeptic');
      expect(s.soul).toBe(POVER_INFO.skeptic);
      expect(s.opponentSouls).toBeUndefined();
    }
  });

  it('a tagged seat debates as its tag soul, keeping the base label and pov', () => {
    const { soul } = seatSouls(TAGGED, 'skeptic');
    expect(soul.voice.disposition).toBe(TAG_DISPOSITION);
    expect(soul.label).toBe(POVER_INFO.skeptic.label);
    expect(soul.pov).toBe(POVER_INFO.skeptic.pov);
  });

  it('every other seat sees the tagged opponent as its tag soul and the untagged ones as base', () => {
    const { soul, opponentSouls } = seatSouls(TAGGED, 'accelerationist');
    expect(soul).toBe(POVER_INFO.accelerationist);
    expect(opponentSouls?.skeptic?.voice.disposition).toBe(TAG_DISPOSITION);
    expect(opponentSouls?.safetyist).toBe(POVER_INFO.safetyist);
    expect(opponentSouls).not.toHaveProperty('accelerationist');
  });

  it('a seat naming a tag with no soul throws rather than silently running as the base persona', () => {
    expect(() => seatSouls({ seat_tags: { skeptic: { pov_tag: 'no-such-tag', tag_mode: 'scope' } } }, 'skeptic')).toThrow(/no-such-tag/);
  });

  it('seatTagSelection maps seat_tags to the pipeline TagSelection', () => {
    expect(seatTagSelection(TAGGED, 'skeptic')).toEqual({ tag: 'critical', mode: 'scope' });
    expect(seatTagSelection(TAGGED, 'safetyist')).toBeUndefined();
  });
});
