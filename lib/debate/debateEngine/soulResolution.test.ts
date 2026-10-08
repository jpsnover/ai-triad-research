// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4007 acceptance criteria — resolveSouls engine pre-flight:
//   - tagged seat refuses (ActionableError) on missing soulResolver
//   - tagged seat refuses on none-tagged scope
//   - tagged seat refuses on below-floor scope
//   - tagged seat with resolver stores soul + provenance
//   - untagged seat with resolver stores base soul + provenance (TL condition 1: all seats)
//   - untagged seat without resolver falls back to POVER_INFO + emits warn

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSouls } from './soulResolution.js';
import { POVER_INFO } from '../types.js';
import type { PovInfo } from '../types.js';
import type { SoulProvenance, SoulResolverFn } from '../soulDocSchema.js';
import type { DebateConfig } from './internals.js';
import type { LoadedTaxonomy } from '../taxonomyLoader.js';
import type { PovNode } from '../taxonomyTypes.js';
import { TAG_SCOPE_MINIMUM_NODES } from '../debateConfig.js';

// ── Minimal fakes ─────────────────────────────────────────

const FAKE_SOUL: PovInfo = { ...POVER_INFO.accelerationist, voice: { ...POVER_INFO.accelerationist.voice, disposition: 'TEST-DISPOSITION' } };
const FAKE_PROV: SoulProvenance = { file: 'soul-docs/accelerationist.test.soul.json', hash: 'abc123' };
const BASE_PROV: SoulProvenance = { file: 'soul-docs/accelerationist.soul.json', hash: 'base456' };

function makeResolver(soul = FAKE_SOUL, prov = FAKE_PROV): SoulResolverFn {
  return vi.fn(() => ({ soul, soulProvenance: prov }));
}

function makeBaseResolver(): SoulResolverFn {
  return vi.fn((speaker) => ({
    soul: POVER_INFO[speaker as keyof typeof POVER_INFO],
    soulProvenance: { file: `soul-docs/${speaker}.soul.json`, hash: 'base456' },
  }));
}

function makeNode(id: string, tags: string[] = []): PovNode {
  return {
    id, category: 'Beliefs', pov: 'accelerationist',
    title: `Node ${id}`, description: '', policy_implications: '',
    pov_tags: tags,
    graph_attributes: { argumentative_function: 'premise', certainty: 'contested', framing: 'neutral', source_credibility: 'credible', novelty: 'standard', importance: 'secondary' },
  };
}

/** Build enough tagged nodes to pass the floor. */
function makeTaggedNodes(count: number, tag: string): PovNode[] {
  return Array.from({ length: count }, (_, i) => makeNode(`acc-bel-${i + 1}`, [tag]));
}

function makeConfig(overrides: Partial<DebateConfig> = {}): DebateConfig {
  return {
    activePovers: ['accelerationist'],
    models: { accelerationist: 'test-model', safetyist: 'test-model', skeptic: 'test-model' },
    ...overrides,
  } as unknown as DebateConfig;
}

function makeTaxonomy(nodes: PovNode[] = []): LoadedTaxonomy {
  return { accelerationist: { nodes }, safetyist: { nodes: [] }, skeptic: { nodes: [] } } as unknown as LoadedTaxonomy;
}

// ── Mocked flight recorder ────────────────────────────────

const mockRecord = vi.fn();
vi.mock('../../flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord, addContextContributor: vi.fn() }),
}));

beforeEach(() => { mockRecord.mockReset(); });

// ── Tests ─────────────────────────────────────────────────

describe('resolveSouls — tagged seat pre-flight', () => {
  it('throws ActionableError when soulResolver absent for tagged seat', () => {
    const config = makeConfig({
      seat_tags: { accelerationist: { pov_tag: 'critical', tag_mode: 'scope' } },
    });
    const nodes = makeTaggedNodes(TAG_SCOPE_MINIMUM_NODES, 'critical');
    expect(() => resolveSouls(config, makeTaxonomy(nodes))).toThrow(/No soulResolver/);
  });

  it('throws ActionableError (none-tagged) when zero nodes carry the tag', () => {
    const config = makeConfig({
      seat_tags: { accelerationist: { pov_tag: 'critical', tag_mode: 'scope' } },
      soulResolver: makeResolver(),
    });
    const nodes = makeTaggedNodes(0, 'critical');
    expect(() => resolveSouls(config, makeTaxonomy(nodes))).toThrow(/No nodes carry tag/);
  });

  it('throws ActionableError (below-floor) when tagged nodes are below minimum', () => {
    const config = makeConfig({
      seat_tags: { accelerationist: { pov_tag: 'critical', tag_mode: 'scope' } },
      soulResolver: makeResolver(),
    });
    const nodes = makeTaggedNodes(TAG_SCOPE_MINIMUM_NODES - 1, 'critical');
    expect(() => resolveSouls(config, makeTaxonomy(nodes))).toThrow(/Scope too thin/);
  });

  it('stores soul and provenance for a tagged seat with sufficient scope', () => {
    const resolver = makeResolver();
    const config = makeConfig({
      seat_tags: { accelerationist: { pov_tag: 'critical', tag_mode: 'scope' } },
      soulResolver: resolver,
    });
    const nodes = makeTaggedNodes(TAG_SCOPE_MINIMUM_NODES, 'critical');
    const { resolvedSouls, soulProv } = resolveSouls(config, makeTaxonomy(nodes));

    expect(resolvedSouls['accelerationist']).toBe(FAKE_SOUL);
    expect(soulProv['accelerationist']).toEqual({ file: FAKE_PROV.file, hash: FAKE_PROV.hash });
  });
});

describe('resolveSouls — untagged seat', () => {
  it('with resolver: stores base soul + provenance (TL condition 1)', () => {
    const resolver = makeBaseResolver();
    const config = makeConfig({ soulResolver: resolver });
    const { resolvedSouls, soulProv } = resolveSouls(config, makeTaxonomy());

    expect(resolvedSouls['accelerationist']).toBe(POVER_INFO.accelerationist);
    expect(soulProv['accelerationist']).toMatchObject({ file: expect.stringMatching(/soul-docs\/accelerationist/), hash: 'base456' });
  });

  it('without resolver: falls back to POVER_INFO and emits a warn', () => {
    const config = makeConfig();
    const { resolvedSouls, soulProv } = resolveSouls(config, makeTaxonomy());

    expect(resolvedSouls['accelerationist']).toBe(POVER_INFO.accelerationist);
    expect(soulProv['accelerationist']).toBeUndefined();
    const warnEvents = mockRecord.mock.calls.map(([e]: [{ level: string }]) => e).filter(e => e.level === 'warn');
    expect(warnEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('untagged seat is not affected by another seat being tagged', () => {
    const resolver = makeBaseResolver();
    const config = makeConfig({
      activePovers: ['accelerationist', 'safetyist'],
      seat_tags: { accelerationist: { pov_tag: 'critical', tag_mode: 'scope' } },
      soulResolver: resolver,
    });
    const nodes = makeTaggedNodes(TAG_SCOPE_MINIMUM_NODES, 'critical');
    const { resolvedSouls } = resolveSouls(config, makeTaxonomy(nodes));

    expect(resolvedSouls['safetyist']).toBe(POVER_INFO.safetyist);
  });
});
