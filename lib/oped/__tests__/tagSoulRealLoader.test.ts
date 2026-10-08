// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/4002 (CL #2885 review): the tagged op-ed voice built through the REAL, unmocked Node soul loader and the
// REAL committed tag soul (lib/debate/soul-docs/skeptic.critical.soul.json, at the t/3989 spec path). The
// other op-ed tests mock the loader, so the real document shape never met the voice block; this one does.
// Only the taxonomy, embeddings, relevance scoring and prompt assembly are mocked.

import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ promptArgs: [] as { pov: string; voiceBlock: string }[] }));

// Six Skeptic nodes tagged "critical", all embedded: a sufficient Scope.
const skp = (n: number, tags?: string[]) => ({
  id: `skp-beliefs-${String(n).padStart(3, '0')}`, category: 'Beliefs', label: `Skeptic ${n}`, description: 'd',
  parent_id: null, children: [], ...(tags ? { pov_tags: tags } : {}),
});
vi.mock('../../debate/taxonomyLoader.js', () => ({
  loadTaxonomy: () => ({
    skeptic: { nodes: [1, 2, 3, 4, 5, 6].map((n) => skp(n, ['critical'])).concat([skp(7)]) },
    situations: { nodes: [{ id: 'sit-001', label: 'Sit', description: 'd', parent_id: null }] },
    embeddings: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`skp-beliefs-00${n}`, { pov: 'skeptic', vector: [1, 0, 0] }])),
  }),
}));
vi.mock('../../embeddings/onnxEmbedding.js', () => ({ computeEmbedding: async () => [1, 0, 0] }));
vi.mock('../../debate/taxonomyRelevance.js', () => ({
  scoreNodeRelevance: () => new Map([1, 2, 3, 4, 5, 6, 7].map((n) => [`skp-beliefs-00${n}`, 0.5])),
  selectRelevantNodes: (nodes: { id: string }[]) => nodes.map((node) => ({ node, score: 0.5 })),
  selectRelevantSituationNodes: (nodes: { id: string }[]) => nodes.map((node) => ({ node, score: 0.5 })),
}));
vi.mock('../outletBands.js', () => ({ resolveOutletBand: () => ({ words: 800, guidance: 'guidance' }) }));
vi.mock('../promptLoader.js', () => ({
  loadAndAssemblePrompt: (_dir: string, args: { pov: string; voiceBlock: string }) => {
    h.promptArgs.push({ pov: args.pov, voiceBlock: args.voiceBlock });
    return { system: 'sys', user: 'user' };
  },
  assembleReflectionPrompt: () => 'refl',
}));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateOpEdSet, type OpEdProgressEvent } from '../generate.js';
import type { OpEdMember } from '../types.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_SOUL = JSON.parse(readFileSync(join(REPO_ROOT, 'lib', 'debate', 'soul-docs', 'skeptic.critical.soul.json'), 'utf-8'));

describe('tagged op-ed voice through the real Node soul loader (t/4002)', () => {
  it('builds the tagged voice block from the real tag soul: its voice.signature and an anti_patterns entry appear', async () => {
    const adapter = { generateText: async () => JSON.stringify({ headline: 'H', subtitle: 'S', body_markdown: 'Body words here.', word_count: 3 }) };
    const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };
    const request = {
      set_id: 's', topic: 'AI policy', povs: ['skeptic' as const],
      params: { model: 'm', wordCount: 800, tagSelection: { pov: 'skeptic' as const, tag: 'critical', mode: 'scope' as const } },
    };
    let member: OpEdMember | undefined;
    for await (const ev of generateOpEdSet(request, deps) as AsyncGenerator<OpEdProgressEvent>) {
      if (ev.type === 'voice_complete') member = ev.member;
    }

    const voiceBlock = h.promptArgs.find((a) => a.pov === 'skeptic')!.voiceBlock;
    expect(typeof REAL_SOUL.voice.signature).toBe('string');
    expect(voiceBlock).toContain(REAL_SOUL.voice.signature);
    expect(voiceBlock).toContain(REAL_SOUL.anti_patterns[0]);
    // Provenance comes from the real loader at the t/3989 spec path, stored repo-relative.
    expect(member!.soul).toMatchObject({ file: 'skeptic.critical.soul.json' });
    expect(member!.soul!.hash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    // Identity stays the camp's (CL t/3960#5).
    expect(member!.byline).toBe('By the Skeptic Camp (Critical wing), as modeled in AI Rosetta Stone');
  });
});
