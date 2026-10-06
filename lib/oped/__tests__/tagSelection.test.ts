// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// POV tags 6/8: op-ed (t/3960; TL t/3960#3/#8, SO e/254#6, CL t/3960#5). The tag applies to ONE member;
// every other member is identical to an untagged run. Bad, missing-soul and thin-Scope tags refuse before
// any generation. The byline keeps the POV label. Every member records which soul file voiced it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  resolvePoverInfo: vi.fn(),
  promptArgs: [] as { pov: string; povLabel: string; voiceBlock: string }[],
  selectCalls: [] as { ids: string[]; scores: Map<string, number> }[],
}));

// A registry with two Skeptic wings: "critical" has enough tagged nodes, "institutional" too few.
vi.mock('../../debate/soul-docs/pov-tags.json', () => ({
  default: {
    version: 1,
    povs: {
      skeptic: [
        { id: 'critical', label: 'Critical', soul_doc: 'skeptic.critical', description: 'Critical wing' },
        { id: 'institutional', label: 'Institutional', soul_doc: 'skeptic.institutional', description: 'Institutional wing' },
      ],
    },
  },
}));

vi.mock('../../debate/soulDocLoader.js', () => ({ resolvePoverInfo: h.resolvePoverInfo }));

const skp = (n: number, tags?: string[]) => ({
  id: `skp-beliefs-${String(n).padStart(3, '0')}`, category: 'Beliefs', label: `Skeptic ${n}`, description: 'd',
  parent_id: null, children: [], ...(tags ? { pov_tags: tags } : {}),
});
vi.mock('../../debate/taxonomyLoader.js', () => ({
  loadTaxonomy: () => ({
    accelerationist: { nodes: [
      { id: 'acc-beliefs-001', category: 'Beliefs', label: 'Acc 1', description: 'd', parent_id: null, children: [] },
      { id: 'acc-desires-001', category: 'Desires', label: 'Acc 2', description: 'd', parent_id: null, children: [] },
    ] },
    safetyist: { nodes: [
      { id: 'saf-beliefs-001', category: 'Beliefs', label: 'Saf 1', description: 'd', parent_id: null, children: [] },
    ] },
    // 6 nodes tagged "critical" (sufficient), 2 tagged "institutional" (thin), 2 untagged.
    skeptic: { nodes: [
      skp(1, ['critical']), skp(2, ['critical']), skp(3, ['critical']), skp(4, ['critical']),
      skp(5, ['critical', 'institutional']), skp(6, ['critical', 'institutional']), skp(7), skp(8),
    ] },
    situations: { nodes: [{ id: 'sit-001', label: 'Sit', description: 'd', parent_id: null }] },
    embeddings: {},
  }),
}));

vi.mock('../../embeddings/onnxEmbedding.js', () => ({ computeEmbedding: async () => [1, 0, 0] }));

// Echo the candidate nodes back, scored from the map the generator passed, so the test sees exactly which
// nodes and scores each camp was selected from.
vi.mock('../../debate/taxonomyRelevance.js', () => ({
  scoreNodeRelevance: () => new Map<string, number>([['skp-beliefs-007', 0.5], ['skp-beliefs-001', 0.4]]),
  selectRelevantNodes: (nodes: { id: string }[], scores: Map<string, number>) => {
    h.selectCalls.push({ ids: nodes.map((n) => n.id), scores });
    return nodes.map((node) => ({ node, score: scores.get(node.id) ?? 0 }));
  },
  selectRelevantSituationNodes: (nodes: { id: string }[]) => nodes.map((node) => ({ node, score: 0.8 })),
}));

vi.mock('../outletBands.js', () => ({ resolveOutletBand: () => ({ words: 800, guidance: 'guidance' }) }));
vi.mock('../promptLoader.js', () => ({
  loadAndAssemblePrompt: (_dir: string, args: { pov: string; povLabel: string; voiceBlock: string }) => {
    h.promptArgs.push({ pov: args.pov, povLabel: args.povLabel, voiceBlock: args.voiceBlock });
    return { system: 'sys', user: 'user' };
  },
  assembleReflectionPrompt: () => 'refl',
}));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateOpEdSet, type OpEdProgressEvent } from '../generate.js';
import { ActionableError } from '../../debate/errors.js';
import { TAG_BOOST_INCREMENT } from '../../debate/debateConfig.js';
import { parseOpEdRequest, parseOpEdSet } from '../schemas.js';
import { AppliedTagSchema, APPLIED_TAG_COUNT_MEANING } from '../../schema/povTags.js';
import type { OpEdMember, OpEdParams } from '../types.js';
import type { PovKey } from '../../debate/types.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const POVS: PovKey[] = ['accelerationist', 'safetyist', 'skeptic'];

// The tag soul: the real Skeptic soul with a recognisable personality and its own label, which must NOT
// become the byline identity.
const TAG_SOUL = {
  ...JSON.parse(readFileSync(join(REPO_ROOT, 'lib', 'debate', 'soul-docs', 'skeptic.soul.json'), 'utf-8')),
  tag: 'critical', label: 'Critical', personality: 'CRITICAL-WING PERSONALITY',
};

const adapter = { generateText: vi.fn(async () => JSON.stringify({ headline: 'H', subtitle: 'S', body_markdown: 'Body words here.', word_count: 3 })) };

async function run(tagSelection?: OpEdParams['tagSelection'], recorder = { record: vi.fn() }): Promise<Map<PovKey, OpEdMember>> {
  const params = { model: 'm', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '', ...(tagSelection ? { tagSelection } : {}) } as OpEdParams;
  const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT, recorder };
  const out = new Map<PovKey, OpEdMember>();
  for await (const ev of generateOpEdSet({ set_id: 's', topic: 'AI policy', params, povs: POVS }, deps) as AsyncGenerator<OpEdProgressEvent>) {
    if (ev.type === 'voice_complete') out.set(ev.pov, ev.member);
  }
  return out;
}

beforeEach(() => {
  h.promptArgs.length = 0;
  h.selectCalls.length = 0;
  adapter.generateText.mockClear();
  h.resolvePoverInfo.mockReset();
  h.resolvePoverInfo.mockReturnValue({
    soul: TAG_SOUL,
    soulProvenance: { file: 'C:\\checkout\\lib\\debate\\soul-docs\\skeptic.critical.soul.json', sha: 'abcdef0123456789' },
  });
});

describe('op-ed tag selection: Scope', () => {
  it('grounds the tagged member only on tagged nodes and records what the tag did', async () => {
    const recorder = { record: vi.fn() };
    const members = await run({ pov: 'skeptic', tag: 'critical', mode: 'scope' }, recorder);
    const skeptic = members.get('skeptic')!;
    expect(skeptic.grounding.filter((g) => g.node_id.startsWith('skp-')).map((g) => g.node_id).sort())
      .toEqual(['skp-beliefs-001', 'skp-beliefs-002', 'skp-beliefs-003', 'skp-beliefs-004', 'skp-beliefs-005', 'skp-beliefs-006']);
    expect(skeptic.tag).toEqual({ pov: 'skeptic', tag: 'critical', mode: 'scope', included: 6, excludedUntagged: 2 });
    // Fallback-path logging: the narrowing is visible.
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', message: expect.stringContaining('excluded 2 untagged') }));
  });

  it('voices the tagged member with the tag soul, but keeps the POV label in the byline and prompt', async () => {
    const members = await run({ pov: 'skeptic', tag: 'critical', mode: 'scope' });
    const skeptic = members.get('skeptic')!;
    expect(skeptic.byline).toBe('By the Skeptic Camp (Critical wing), as modeled in AI Rosetta Stone');
    expect(skeptic.byline).not.toMatch(/By the Critical Camp/);
    expect(skeptic.disclosure).toContain('illustrate the Critical wing of the Skeptic perspective');
    const skepticPrompt = h.promptArgs.find((a) => a.pov === 'skeptic')!;
    expect(skepticPrompt.povLabel).toBe('Skeptic (Critical wing)');
    expect(skepticPrompt.voiceBlock).toContain('CRITICAL-WING PERSONALITY');
    expect(h.resolvePoverInfo).toHaveBeenCalledWith('skeptic', { tag: 'critical', mode: 'scope' });
  });

  it('records a repo-relative soul file for the tagged member, never the absolute path', async () => {
    const members = await run({ pov: 'skeptic', tag: 'critical', mode: 'scope' });
    expect(members.get('skeptic')!.soul).toEqual({ file: 'lib/debate/soul-docs/skeptic.critical.soul.json', sha: 'abcdef0123456789' });
  });

  it('leaves every OTHER member identical to an untagged run (SO e/252 cond 5 form)', async () => {
    const untagged = await run();
    const untaggedPrompts = [...h.promptArgs];
    const tagged = await run({ pov: 'skeptic', tag: 'critical', mode: 'scope' });
    for (const pov of ['accelerationist', 'safetyist'] as PovKey[]) {
      expect(tagged.get(pov), pov).toEqual(untagged.get(pov));
      expect(h.promptArgs.find((a) => a.pov === pov), pov).toEqual(untaggedPrompts.find((a) => a.pov === pov));
      expect(tagged.get(pov)!.tag).toBeUndefined();
    }
  });
});

describe('op-ed tag selection: Prioritize', () => {
  it('keeps every node, boosts the tagged ones, and records excludedUntagged as 0', async () => {
    const members = await run({ pov: 'skeptic', tag: 'critical', mode: 'prioritize' });
    const call = h.selectCalls.find((c) => c.ids.some((id) => id.startsWith('skp-')))!;
    expect(call.ids).toHaveLength(8);
    expect(call.scores.get('skp-beliefs-001')).toBeCloseTo(0.4 + TAG_BOOST_INCREMENT);
    expect(call.scores.get('skp-beliefs-007')).toBe(0.5); // untagged: not boosted
    expect(members.get('skeptic')!.tag).toEqual({ pov: 'skeptic', tag: 'critical', mode: 'prioritize', included: 6, excludedUntagged: 0 });
  });
});

describe('op-ed tag selection: pre-flight refusals (no generation, no partial set)', () => {
  async function refusal(tagSelection: OpEdParams['tagSelection']): Promise<unknown> {
    try {
      await run(tagSelection);
    } catch (err) {
      return err;
    }
    return undefined;
  }

  it('REFUSES a thin Scope, with the counts, instead of warning (TL t/3960#3 cond 1)', async () => {
    const err = await refusal({ pov: 'skeptic', tag: 'institutional', mode: 'scope' });
    expect(err).toBeInstanceOf(ActionableError);
    expect(String((err as Error).message)).toMatch(/2 in scope, 6 untagged would be excluded/);
    expect(adapter.generateText).not.toHaveBeenCalled();
  });

  it('allows the same thin tag in Prioritize, which excludes nothing', async () => {
    const members = await run({ pov: 'skeptic', tag: 'institutional', mode: 'prioritize' });
    expect(members.get('skeptic')!.tag).toMatchObject({ mode: 'prioritize', included: 2, excludedUntagged: 0 });
  });

  it('REFUSES when the tag soul cannot load: no fallback to the base soul', async () => {
    h.resolvePoverInfo.mockImplementation(() => { throw new ActionableError({ goal: 'g', problem: 'tag soul missing', location: 'l', nextSteps: [] }); });
    const err = await refusal({ pov: 'skeptic', tag: 'critical', mode: 'scope' });
    expect(String((err as Error).message)).toMatch(/tag soul missing/);
    expect(adapter.generateText).not.toHaveBeenCalled();
  });

  it('REFUSES an unregistered tag, and a tag whose POV is not requested', async () => {
    expect(String((await refusal({ pov: 'skeptic', tag: 'radical', mode: 'scope' }) as Error).message)).toMatch(/not registered/);
    expect(String((await refusal({ pov: 'safetyist', tag: 'critical', mode: 'scope' }) as Error).message)).toMatch(/safetyist has no tags/);
    expect(adapter.generateText).not.toHaveBeenCalled();
  });
});

describe('parseOpEdRequest (the live boundary)', () => {
  const req = (tagSelection?: unknown, povs: string[] = POVS) => ({ topic: 't', povs, params: { model: 'm', wordCount: 800, ...(tagSelection ? { tagSelection } : {}) } });

  it('accepts an untagged request and a registered tag for a requested POV, returning it unchanged', () => {
    const untagged = req();
    expect(parseOpEdRequest(untagged)).toBe(untagged);
    expect(() => parseOpEdRequest(req({ pov: 'skeptic', tag: 'critical', mode: 'prioritize' }))).not.toThrow();
  });

  it('rejects an unknown tag, a POV not in povs, a half selection and an extra key', () => {
    expect(() => parseOpEdRequest(req({ pov: 'skeptic', tag: 'radical', mode: 'scope' }))).toThrow(/not registered/);
    expect(() => parseOpEdRequest(req({ pov: 'skeptic', tag: 'critical', mode: 'scope' }, ['accelerationist']))).toThrow(/not one of the requested povs/);
    expect(() => parseOpEdRequest(req({ pov: 'skeptic', tag: 'critical' }))).toThrow(ActionableError);
    expect(() => parseOpEdRequest(req({ pov: 'skeptic', tag: 'critical', mode: 'scope', weight: 2 }))).toThrow(ActionableError);
  });
});

describe('the persisted set keeps the tag fields (strip regression, t/2890 class)', () => {
  it('round-trips params.tagSelection, member.tag and member.soul, even for a tag the registry no longer lists', () => {
    const member = {
      pov: 'skeptic', status: 'complete', headline: 'H', subtitle: '', body: 'b', byline: '', disclosure: '', rhetorical_meta: '', wordCount: 1, grounding: [],
      tag: { pov: 'skeptic', tag: 'retired', mode: 'scope', included: 3, excludedUntagged: 9 },
      soul: { file: 'lib/debate/soul-docs/skeptic.retired.soul.json', sha: '0123456789abcdef' },
    };
    const set = {
      schema_version: 1, set_id: 's', topic: 't', created_at: 'now',
      params: { model: 'm', wordCount: 800, tagSelection: { pov: 'skeptic', tag: 'retired', mode: 'scope' } },
      opeds: [member],
    };
    const parsed = parseOpEdSet(set);
    expect(parsed.params.tagSelection).toEqual(set.params.tagSelection);
    expect(parsed.opeds[0].tag).toEqual(member.tag);
    expect(parsed.opeds[0].soul).toEqual(member.soul);
  });
});

describe('AppliedTagSchema: count meanings are pinned in the record (SO e/254#6 cond 3)', () => {
  it('describes both counts per mode, and says Prioritize excludedUntagged is not full coverage', () => {
    expect(AppliedTagSchema.shape.included.description).toBe(APPLIED_TAG_COUNT_MEANING.included);
    expect(AppliedTagSchema.shape.excludedUntagged.description).toBe(APPLIED_TAG_COUNT_MEANING.excludedUntagged);
    for (const meaning of Object.values(APPLIED_TAG_COUNT_MEANING)) {
      expect(meaning).toMatch(/scope:/);
      expect(meaning).toMatch(/prioritize:/);
    }
    expect(APPLIED_TAG_COUNT_MEANING.excludedUntagged).toMatch(/excludes nothing, NOT full coverage/);
  });
});

describe('op-ed tag selection: untagged runs', () => {
  it('carry no tag, and record each member\'s base soul file', async () => {
    const members = await run();
    // The untagged byline and disclosure are unchanged from before this feature.
    expect(members.get('skeptic')!.byline).toBe('By the Skeptic Camp, as modeled in AI Rosetta Stone');
    expect(members.get('skeptic')!.disclosure).toBe('Generated by AI Rosetta Stone to illustrate the Skeptic perspective. Not authored by any person; not for submission or publication.');
    for (const pov of POVS) {
      expect(members.get(pov)!.tag).toBeUndefined();
      expect(members.get(pov)!.soul).toMatchObject({ file: `lib/debate/soul-docs/${pov}.soul.json` });
      expect(members.get(pov)!.soul!.sha).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(h.resolvePoverInfo).not.toHaveBeenCalled();
  });
});
