// @vitest-environment node
//
// t/2727 — op-ed public-share projection (the info-leak control). projectPublicOpEd
// is a POSITIVE field allowlist: an OpEdSet laden with generation params (model,
// prompts, thesis, authorBio, newsHook) and grounding internals must project to
// EXACTLY the public wire shape and nothing more. This is what guarantees no private
// field is ever written to the public copy at rest.

import { describe, it, expect } from 'vitest';
import { projectPublicOpEd } from '../storage/opedShareStore.js';
import type { OpEdSet } from '../../../../lib/oped/types.js';

const ladenSet = {
  schema_version: 1,
  set_id: 'set-private-uuid',
  topic: 'AI liability regimes',
  // Generation params — MUST NOT leak (prompts + model + editorial internals).
  params: {
    outlet: 'NYTimes',
    wordCount: 800,
    model: 'gemini-3.5-flash-lite',
    thesis: 'PRIVATE thesis steering the model',
    authorBio: 'PRIVATE author bio',
    newsHook: 'PRIVATE news hook',
  },
  created_at: '2026-08-17T00:00:00Z',
  opeds: [
    {
      pov: 'accelerationist',
      status: 'complete',
      headline: 'The case for speed',
      subtitle: 'Why caution costs lives',
      body: 'Full essay body text.',
      wordCount: 812,
      grounding: [
        { node_id: 'acc-beliefs-095', label: 'internal', category: 'beliefs', pov: 'accelerationist', relevance: '0.9', how_reflected: 'internal note' },
      ],
    },
  ],
} as unknown as OpEdSet;

describe('projectPublicOpEd — positive allowlist (info-leak guard, t/2727)', () => {
  it('returns EXACTLY the public top-level keys and nothing else', () => {
    const pub = projectPublicOpEd(ladenSet, 'share-xyz');
    expect(Object.keys(pub).sort()).toEqual(
      ['schema_version', 'shareId', 'topic', 'outlet', 'created_at', 'opeds'].sort(),
    );
    // The public URL key replaces the private storage set_id.
    expect(pub.shareId).toBe('share-xyz');
    expect(pub).not.toHaveProperty('set_id');
    expect(pub).not.toHaveProperty('params');
  });

  it('per-voice members carry EXACTLY the public fields — no grounding', () => {
    const pub = projectPublicOpEd(ladenSet, 'share-xyz');
    expect(pub.opeds).toHaveLength(1);
    expect(Object.keys(pub.opeds[0]).sort()).toEqual(
      ['pov', 'status', 'headline', 'subtitle', 'body', 'wordCount'].sort(),
    );
  });

  it('leaks NONE of the private fields anywhere in the serialized output', () => {
    const serialized = JSON.stringify(projectPublicOpEd(ladenSet, 'share-xyz'));
    for (const forbidden of [
      'set-private-uuid',              // storage set_id
      'PRIVATE thesis',                // params.thesis
      'PRIVATE author bio',            // params.authorBio
      'PRIVATE news hook',             // params.newsHook
      'gemini-3.5-flash-lite',         // params.model
      'how_reflected', 'node_id',      // grounding internals
      'acc-beliefs-095',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('carries the public-safe fields verbatim (topic, outlet, essay content)', () => {
    const pub = projectPublicOpEd(ladenSet, 'share-xyz');
    expect(pub.topic).toBe('AI liability regimes');
    expect(pub.outlet).toBe('NYTimes'); // editorial context is public-safe
    expect(pub.created_at).toBe('2026-08-17T00:00:00Z');
    expect(pub.opeds[0]).toEqual({
      pov: 'accelerationist',
      status: 'complete',
      headline: 'The case for speed',
      subtitle: 'Why caution costs lives',
      body: 'Full essay body text.',
      wordCount: 812,
    });
  });

  it('outlet is null when params carry no outlet', () => {
    const noOutlet = { ...ladenSet, params: { ...ladenSet.params, outlet: undefined } } as unknown as OpEdSet;
    expect(projectPublicOpEd(noOutlet, 's').outlet).toBeNull();
  });
});
