// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2719 — voices must generate SEQUENTIALLY (concurrency 1), not in a Promise.all
// fan-out. Parallel fan-out kept every voice's AI response + JSON.parse resident at once
// which, on top of the in-process ONNX model + embeddings + taxonomy, OOM-crashed the Node
// server mid-stream (a single create took the whole process down). This test locks the
// serialization: an instrumented adapter records the max number of concurrent generateText
// calls; sequential generation ⇒ 1, the old parallel fan-out ⇒ N (one per voice).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../embeddings/onnxEmbedding.js', () => ({ computeEmbedding: async () => [1, 0, 0] }));
vi.mock('../debate/taxonomyLoader.js', () => ({
  loadTaxonomy: () => ({
    accelerationist: { nodes: [{ id: 'acc-bel-001', category: 'Belief', label: 'l', description: 'd', parent_id: null, children: [] }] },
    safetyist: { nodes: [{ id: 'saf-bel-001', category: 'Belief', label: 'l', description: 'd', parent_id: null, children: [] }] },
    skeptic: { nodes: [{ id: 'skp-bel-001', category: 'Belief', label: 'l', description: 'd', parent_id: null, children: [] }] },
    situations: { nodes: [{ id: 'sit-001', label: 'l', description: 'd', parent_id: null }] },
    embeddings: {},
  }),
}));
vi.mock('../debate/taxonomyRelevance.js', () => ({
  scoreNodeRelevance: () => new Map(),
  selectRelevantNodes: (nodes: { id: string }[]) => nodes.map(node => ({ node, score: 0.9 })),
  selectRelevantSituationNodes: (nodes: { id: string }[]) => nodes.map(node => ({ node, score: 0.8 })),
}));
vi.mock('./outletBands.js', () => ({ resolveOutletBand: () => ({ words: 800, guidance: 'g' }) }));
vi.mock('./promptLoader.js', () => ({
  loadAndAssemblePrompt: () => ({ system: 'sys', user: 'user' }),
  assembleReflectionPrompt: () => 'refl',
  assembleSourceBriefPrompt: () => 'source-brief-prompt',
}));

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateOpEdSet, type OpEdProgressEvent } from './generate.js';
import type { PovKey } from '../debate/types.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('generateOpEdSet — sequential voice generation (t/2719 OOM regression)', () => {
  it('never runs more than one voice generation concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const adapter = {
      generateText: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so that, if voices were fanned out in parallel, their calls would overlap here.
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return JSON.stringify({ headline: 'H', subtitle: 'S', body_markdown: 'Body.', word_count: 1 });
      },
    };
    const req = {
      set_id: 's1', topic: 'AI policy',
      params: { model: 'gemini-flash', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '' } as never,
      povs: ['accelerationist', 'safetyist', 'skeptic'] as PovKey[],
    };
    const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };

    const completed: PovKey[] = [];
    for await (const ev of generateOpEdSet(req, deps) as AsyncGenerator<OpEdProgressEvent>) {
      if (ev.type === 'voice_complete') completed.push(ev.pov);
    }

    // All three voices still produced (sequential doesn't drop any) …
    expect(completed.sort()).toEqual(['accelerationist', 'safetyist', 'skeptic']);
    // … but never more than one AI generation was in flight at once.
    expect(maxInFlight).toBe(1);
  });
});

describe('generateOpEdSet — document_claims propagation (t/2722)', () => {
  it('populates document_claims on grounding refs when reflection returns them', async () => {
    let call = 0;
    const adapter = {
      generateText: async () => {
        call++;
        if (call % 2 === 1) {
          // Essay generation call
          return JSON.stringify({ headline: 'H', subtitle: '', body_markdown: 'Body text here.', word_count: 3 });
        }
        // Reflection call — include document_claims for one node
        return JSON.stringify({
          grounding_usage: [
            { id: 'acc-bel-001', reflection: 'used in lede', document_claims: ['claim A', 'claim B'] },
            { id: 'sit-001', reflection: 'used as evidence', document_claims: [] },
          ],
        });
      },
    };
    const req = {
      set_id: 's2', topic: 'AI policy',
      params: { model: 'gemini-flash', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '' } as never,
      povs: ['accelerationist'] as PovKey[],
    };
    const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };

    let member: { grounding: { node_id: string; document_claims?: string[] }[] } | undefined;
    for await (const ev of generateOpEdSet(req, deps) as AsyncGenerator<OpEdProgressEvent>) {
      if (ev.type === 'voice_complete') member = ev.member as typeof member;
    }

    expect(member).toBeDefined();
    const bdiRef = member!.grounding.find(r => r.node_id === 'acc-bel-001');
    expect(bdiRef?.document_claims).toEqual(['claim A', 'claim B']);
    // Empty document_claims array → field stays absent (only set when length > 0)
    const sitRef = member!.grounding.find(r => r.node_id === 'sit-001');
    expect(sitRef?.document_claims).toBeUndefined();
  });
});

describe('generateOpEdSet — Step 0 source-brief comprehension (t/2722)', () => {
  const ESSAY_JSON = JSON.stringify({ headline: 'H', subtitle: '', body_markdown: 'Body.', word_count: 1 });
  const REFL_JSON = JSON.stringify({ grounding_usage: [] });

  it('yields source_brief_done before grounding_done when comprehension succeeds', async () => {
    const BRIEF_JSON = JSON.stringify({
      thesis: 'AI labs must share safety research',
      author: 'Test Org', actor_type: 'think tank',
      stance: 'FOR mandatory sharing',
      primary_recommendations: ['Mandate sharing within 30 days'],
      key_claims: ['Safety incidents doubled last year', 'Only 3 labs share proactively'],
      readable: true,
    });
    const adapter = {
      generateText: async (prompt: string) => {
        if (prompt === 'source-brief-prompt') return BRIEF_JSON;
        if (prompt === 'refl') return REFL_JSON;
        return ESSAY_JSON;
      },
    };
    const req = {
      set_id: 's3', topic: 'AI safety sharing',
      params: { model: 'gemini-flash', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '' } as never,
      povs: ['accelerationist'] as PovKey[],
      sourceMaterial: 'Full document text...',
    };
    const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };

    const events: string[] = [];
    for await (const ev of generateOpEdSet(req, deps) as AsyncGenerator<OpEdProgressEvent>) {
      events.push(ev.type);
    }

    expect(events).toContain('source_brief_done');
    const briefIdx = events.indexOf('source_brief_done');
    const groundingIdx = events.indexOf('grounding_done');
    expect(briefIdx).toBeGreaterThanOrEqual(0);
    expect(groundingIdx).toBeGreaterThanOrEqual(0);
    expect(briefIdx).toBeLessThan(groundingIdx);
  });

  it('yields source_brief_failed but still completes when comprehension throws', async () => {
    const adapter = {
      generateText: async (prompt: string) => {
        if (prompt === 'source-brief-prompt') throw new Error('network error');
        if (prompt === 'refl') return REFL_JSON;
        return ESSAY_JSON;
      },
    };
    const req = {
      set_id: 's4', topic: 'AI safety',
      params: { model: 'gemini-flash', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '' } as never,
      povs: ['accelerationist'] as PovKey[],
      sourceMaterial: 'Some text',
    };
    const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };

    const events: string[] = [];
    for await (const ev of generateOpEdSet(req, deps) as AsyncGenerator<OpEdProgressEvent>) {
      events.push(ev.type);
    }

    expect(events).toContain('source_brief_failed');
    expect(events).toContain('complete'); // non-fatal
    expect(events).not.toContain('source_brief_done');
  });

  it('skips Step 0 entirely when no sourceMaterial is provided', async () => {
    const adapter = {
      generateText: async (prompt: string) => {
        if (prompt === 'source-brief-prompt') throw new Error('should not be called');
        if (prompt === 'refl') return REFL_JSON;
        return ESSAY_JSON;
      },
    };
    const req = {
      set_id: 's5', topic: 'AI policy',
      params: { model: 'gemini-flash', wordCount: 800, outlet: 'nyt', newsHook: '', thesis: '' } as never,
      povs: ['accelerationist'] as PovKey[],
    };
    const deps = { adapter: adapter as never, promptsDir: join(REPO_ROOT, 'lib', 'oped', 'prompts'), repoRoot: REPO_ROOT };

    const events: string[] = [];
    for await (const ev of generateOpEdSet(req, deps) as AsyncGenerator<OpEdProgressEvent>) {
      events.push(ev.type);
    }

    expect(events).not.toContain('source_brief_done');
    expect(events).not.toContain('source_brief_failed');
    expect(events).toContain('complete');
  });
});
