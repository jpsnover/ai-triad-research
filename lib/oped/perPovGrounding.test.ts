// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression: per-POV BDI grounding in generateOpEdSet.
//
// The taxonomy is camp-partitioned (`taxonomy[pov].nodes`, node ids `{pov}-{cat}-{NNN}`),
// so each camp's grounding IS its own belief/desire/intention nodes. A prior version
// selected grounding ONCE from `request.povs[0]` and reused that array for every voice,
// so all voices displayed identical grounding tables (a Safetyist essay grounded in
// `acc-*` nodes). This locks the fix: each voice's grounding must come from its OWN camp;
// only situations (camp-agnostic) are legitimately shared.

import { describe, it, expect, vi } from 'vitest';

// ── Heavy-dep mocks (embedding model, taxonomy IO, relevance scoring, prompts, fs) ──

vi.mock('../embeddings/onnxEmbedding.js', () => ({
  computeEmbedding: async () => [1, 0, 0],
}));

vi.mock('../debate/taxonomyLoader.js', () => ({
  loadTaxonomy: () => ({
    accelerationist: { nodes: [
      { id: 'acc-bel-001', category: 'Belief', label: 'Acceleration compounds', description: 'd', parent_id: null, children: [] },
      { id: 'acc-des-001', category: 'Desire', label: 'Deploy fast', description: 'd', parent_id: null, children: [] },
    ] },
    safetyist: { nodes: [
      { id: 'saf-bel-001', category: 'Belief', label: 'Unaligned AI is existential', description: 'd', parent_id: null, children: [] },
      { id: 'saf-des-001', category: 'Desire', label: 'Slow deployment', description: 'd', parent_id: null, children: [] },
    ] },
    skeptic: { nodes: [
      { id: 'skp-bel-001', category: 'Belief', label: 'Capabilities are overstated', description: 'd', parent_id: null, children: [] },
      { id: 'skp-des-001', category: 'Desire', label: 'Demand evidence', description: 'd', parent_id: null, children: [] },
    ] },
    situations: { nodes: [
      { id: 'sit-001', label: 'Open-weight misuse', description: 'd', parent_id: null },
    ] },
    embeddings: {},
  }),
}));

// Echo the nodes each call receives back as scored refs — so a voice's grounding reflects
// EXACTLY the camp-partitioned node array that generateOpEdSet passed to it.
vi.mock('../debate/taxonomyRelevance.js', () => ({
  scoreNodeRelevance: () => new Map(),
  selectRelevantNodes: (nodes: { id: string }[]) => nodes.map(node => ({ node, score: 0.9 })),
  selectRelevantSituationNodes: (nodes: { id: string }[]) => nodes.map(node => ({ node, score: 0.8 })),
}));

vi.mock('./outletBands.js', () => ({
  resolveOutletBand: () => ({ words: 800, guidance: 'guidance' }),
}));

vi.mock('./promptLoader.js', () => ({
  loadAndAssemblePrompt: () => ({ system: 'sys', user: 'user' }),
  assembleReflectionPrompt: () => 'refl',
}));

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateOpEdSet, type OpEdProgressEvent } from './generate.js';
import type { PovKey } from '../debate/types.js';

// Real repo root, so loadSoulDoc reads the actual lib/debate/soul-docs/*.soul.json
// (taxonomy + embeddings + prompts are mocked; only the soul docs load for real).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Adapter returns a valid essay JSON for the essay pass; the best-effort reflection pass
// then re-parses it, finds no `grounding_usage`, and is swallowed (how_reflected stays default).
const adapter = {
  generateText: async () => JSON.stringify({ headline: 'H', subtitle: 'S', body_markdown: 'Body words here.', word_count: 3 }),
};

async function drain(povs: PovKey[]): Promise<Map<PovKey, string[]>> {
  const req = {
    set_id: 's1', topic: 'AI policy',
    params: { model: 'gemini-flash', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '' } as never,
    povs,
  };
  const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };
  const byPov = new Map<PovKey, string[]>();
  for await (const ev of generateOpEdSet(req, deps) as AsyncGenerator<OpEdProgressEvent>) {
    if (ev.type === 'voice_complete') {
      byPov.set(ev.pov, ev.member.grounding.map(g => g.node_id));
    }
  }
  return byPov;
}

describe('generateOpEdSet — per-POV grounding (regression)', () => {
  it('grounds each voice in its OWN camp BDI nodes, not the first POV\'s', async () => {
    const byPov = await drain(['accelerationist', 'safetyist', 'skeptic']);

    const acc = byPov.get('accelerationist')!;
    const saf = byPov.get('safetyist')!;
    const skp = byPov.get('skeptic')!;

    // Each voice's BDI grounding carries only its own camp prefix.
    expect(acc.filter(id => id.startsWith('acc-')).length).toBeGreaterThan(0);
    expect(acc.some(id => id.startsWith('saf-') || id.startsWith('skp-'))).toBe(false);
    expect(saf.some(id => id.startsWith('saf-'))).toBe(true);
    expect(saf.some(id => id.startsWith('acc-') || id.startsWith('skp-'))).toBe(false);
    expect(skp.some(id => id.startsWith('skp-'))).toBe(true);
    expect(skp.some(id => id.startsWith('acc-') || id.startsWith('saf-'))).toBe(false);
  });

  it('shares the camp-agnostic situation grounding across all voices', async () => {
    const byPov = await drain(['accelerationist', 'safetyist', 'skeptic']);
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as PovKey[]) {
      expect(byPov.get(pov)!).toContain('sit-001');
    }
  });

  it('does NOT give every voice the identical grounding set (the original bug)', async () => {
    const byPov = await drain(['accelerationist', 'safetyist', 'skeptic']);
    const acc = [...byPov.get('accelerationist')!].sort().join(',');
    const saf = [...byPov.get('safetyist')!].sort().join(',');
    expect(acc).not.toEqual(saf);
  });
});
