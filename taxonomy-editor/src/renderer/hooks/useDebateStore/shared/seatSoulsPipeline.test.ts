// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3975, half 2 of 2: seatSouls' output, given to the REAL opening and turn pipelines, reaches the prompts
// the model is sent. Half 1 (__tests__/seatSoulsOpenings.test.ts, plus the construction check below) shows
// the store passes exactly these fields. Together they catch a soul dropped anywhere between the session's
// seat_tags and the prompt text, including inside lib's runners (t/3988).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runOpeningPipeline } from '@lib/debate/turnPipeline/opening';
import { runTurnPipeline } from '@lib/debate/turnPipeline/runTurn';
import type { OpeningPipelineInput } from '@lib/debate/turnPipeline/opening';
import type { TurnPipelineInput } from '@lib/debate/turnPipeline/types';
import { POVER_INFO } from '@lib/debate/poverInfo';
import skepticCritical from '@lib/debate/soul-docs/skeptic.critical.soul.json';
import skepticInstitutional from '@lib/debate/soul-docs/skeptic.institutional.soul.json';
import { seatSouls } from './seatSouls';
import { buildDebateResponsePrompt } from './prompts';
import { debateResponsePrompt } from '../../../prompts/debate';

const TAGGED = { seat_tags: { skeptic: { pov_tag: 'critical', tag_mode: 'scope' as const } } };
const TAG_DISPOSITION = skepticCritical.voice.disposition;
// Opponents see only the disposition up to its em dash (otherDebaters). 'critical' shares that prefix with
// the base Skeptic soul, so the opponent arm uses 'institutional', whose prefix differs.
const short = (d: string) => d.split('—')[0].trim();
const INSTITUTIONAL = { seat_tags: { skeptic: { pov_tag: 'institutional', tag_mode: 'scope' as const } } };
const INST_SHORT = short(skepticInstitutional.voice.disposition);
const BASE_SHORT = short(POVER_INFO.skeptic.voice.disposition);

type Seat = 'accelerationist' | 'safetyist' | 'skeptic';

/** Every prompt a real runner sends; stages answer '{}' and later parse failures don't matter. */
async function sent(run: (generate: (prompt: string) => Promise<string>) => Promise<unknown>): Promise<string> {
  const prompts: string[] = [];
  await run(async (prompt) => { prompts.push(prompt); return '{}'; }).catch(() => undefined);
  expect(prompts.length).toBeGreaterThan(0);
  return prompts.join('\n');
}

function base(speaker: Seat, session: object) {
  const souls = seatSouls(session, speaker);
  const info = souls.soul;
  return {
    label: info.label, pov: info.pov, personality: info.personality, soul: souls.soul, opponentSouls: souls.opponentSouls,
    topic: 'Should frontier AI labs be licensed?', taxonomyContext: '', model: 'test-model',
  };
}

const opening = (speaker: Seat, session: object) => sent(g =>
  runOpeningPipeline({ ...base(speaker, session), priorStatements: '', isFirst: true } as unknown as OpeningPipelineInput, g));

const turn = (speaker: Seat, session: object) => sent(g =>
  runTurnPipeline({
    ...base(speaker, session), commitmentContext: '', recentTranscript: '', focusPoint: 'licensing', addressing: 'all', phase: 'argumentation',
  } as unknown as TurnPipelineInput, g));

describe.each([['opening', opening], ['turn', turn]] as const)('%s pipeline: a tagged seat reaches the prompt (t/3975)', (_name, run) => {
  it('the tagged speaker is sent its tag disposition, not the base one', async () => {
    const text = await run('skeptic', TAGGED);
    expect(text).toContain(TAG_DISPOSITION);
    expect(text).not.toContain(POVER_INFO.skeptic.voice.disposition);
  });

  it('an untagged speaker is told the tagged opponent\'s disposition', async () => {
    expect(INST_SHORT).not.toBe(BASE_SHORT); // the arm discriminates
    const text = await run('safetyist', INSTITUTIONAL);
    expect(text).toContain(`(${INST_SHORT})`);
    expect(text).not.toContain(`(${BASE_SHORT})`);
  });

  it('untagged debate: the base disposition, as before', async () => {
    expect(await run('skeptic', {})).toContain(POVER_INFO.skeptic.voice.disposition);
  });
});

// The single-turn response path (debateLoopSlice → buildDebateResponsePrompt) builds its prompt directly.
describe('buildDebateResponsePrompt with seat souls (t/3975)', () => {
  const build = (speaker: Seat, session: object) =>
    buildDebateResponsePrompt(seatSouls(session, speaker), 'Should frontier AI labs be licensed?', '', '', 'Why?', 'all');

  it('a tagged speaker is sent its tag disposition', () => {
    const text = build('skeptic', TAGGED);
    expect(text).toContain(TAG_DISPOSITION);
    expect(text).not.toContain(POVER_INFO.skeptic.voice.disposition);
  });

  it('an untagged speaker is told the tagged opponent\'s disposition', () => {
    expect(build('safetyist', INSTITUTIONAL)).toContain(`(${INST_SHORT})`);
  });

  it('souls is required: no base-soul fallback when it is missing (SO e/256#9)', () => {
    // The production callers are type-checked against the required param. Test files are excluded from
    // renderer tsc, so this run-time check is what fails if a `souls ?? POVER_INFO[...]` fallback returns.
    // @ts-expect-error -- deliberately omitting the required souls
    expect(() => buildDebateResponsePrompt(undefined, 'T', '', '', 'Q', 'all')).toThrow(TypeError);
  });

  it('an untagged seat gets the base prompt, byte for byte (the pre-t/3975 call: base fields, no souls)', () => {
    const base = POVER_INFO.skeptic;
    expect(buildDebateResponsePrompt(seatSouls({}, 'skeptic'), 'T', '', '', 'Q', 'all'))
      .toBe(debateResponsePrompt(base.label, base.pov, base.personality, 'T', '', '', 'Q', 'all'));
  });
});

// The turn path has no store-level harness test (the cross-respond driver needs the moderator), so,
// like lib's openingCoverage (t/3777), check that every TurnPipelineInput the slice builds carries both
// soul fields, as a spread of a seatSouls() result (SeatSouls is exactly { soul, opponentSouls? }) or as
// both keys. With the behavioral tests above, a slice that builds the input without them fails here.
describe('debatePhaseSlice builds every TurnPipelineInput with the seat souls (t/3975)', () => {
  const src = readFileSync(path.resolve(process.cwd(), 'src/renderer/hooks/useDebateStore/slices/debatePhaseSlice.ts'), 'utf8');
  const literals = [...src.matchAll(/:\s*TurnPipelineInput\s*=\s*\{([\s\S]*?)\n\s*\};/g)].map(m => m[1]);
  const seatSoulsVars = new Set([...src.matchAll(/const (\w+) = seatSouls\(/g)].map(m => m[1]));
  const carriesSouls = (body: string) =>
    /\.\.\.seatSouls\(/.test(body)
    || [...body.matchAll(/\.\.\.(\w+)\s*,/g)].some(m => seatSoulsVars.has(m[1]))
    || (/\bsoul:/.test(body) && /\bopponentSouls:/.test(body));

  it('finds the slice\'s pipeline inputs (cross-respond and post-termination)', () => {
    expect(literals.length).toBeGreaterThanOrEqual(2);
  });

  it('every one carries soul and opponentSouls', () => {
    for (const body of literals) expect(carriesSouls(body), body.slice(0, 120)).toBe(true);
  });
});
