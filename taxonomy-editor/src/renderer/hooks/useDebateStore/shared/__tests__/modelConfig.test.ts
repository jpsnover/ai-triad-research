// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';

// resolveBriefModel / getSpeakerModel are pure. modelConfig also imports the stores (only
// getConfiguredModel uses them) — stub them so this stays a hermetic leaf test with no
// store side-effects (avoids cross-file mock-graph coupling).
vi.mock('../store', () => ({ useDebateStore: { getState: () => ({ debateModel: '' }) } }));
vi.mock('../../useTaxonomyStore', () => ({ useTaxonomyStore: { getState: () => ({ geminiModel: '' }) } }));

import { resolveBriefModel, getSpeakerModel } from '../modelConfig';

describe('resolveBriefModel (t/2504 — brief-timeout toast model)', () => {
  const FALLBACK = 'gemini-flash-lite-latest';

  it('stage-level brief override wins over speaker model and base fallback', () => {
    const debate = {
      stage_models: { brief: 'cheap-brief' },
      speaker_models: { skeptic: 'moonshot-kimi-k3' },
    };
    expect(resolveBriefModel(debate, 'skeptic', FALLBACK)).toBe('cheap-brief');
  });

  it('falls back to the speaker model when no brief stage override is set', () => {
    const debate = { speaker_models: { skeptic: 'moonshot-kimi-k3' } };
    expect(resolveBriefModel(debate, 'skeptic', FALLBACK)).toBe('moonshot-kimi-k3');
    // and mirrors getSpeakerModel exactly in this case
    expect(resolveBriefModel(debate, 'skeptic', FALLBACK)).toBe(getSpeakerModel(debate, 'skeptic', FALLBACK));
  });

  it('falls back to the base model when neither a brief override nor a speaker model is set', () => {
    expect(resolveBriefModel({ speaker_models: {} }, 'skeptic', FALLBACK)).toBe(FALLBACK);
    expect(resolveBriefModel(null, 'skeptic', FALLBACK)).toBe(FALLBACK);
  });

  it('resolves per-speaker: each speaker gets its own model (no brief override)', () => {
    const debate = {
      speaker_models: { skeptic: 'moonshot-kimi-k3', accelerationist: 'gemini-2.5-flash' },
    };
    expect(resolveBriefModel(debate, 'skeptic', FALLBACK)).toBe('moonshot-kimi-k3');
    expect(resolveBriefModel(debate, 'accelerationist', FALLBACK)).toBe('gemini-2.5-flash');
    // a speaker with no per-speaker entry still falls back
    expect(resolveBriefModel(debate, 'safetyist', FALLBACK)).toBe(FALLBACK);
  });

  it('never returns empty string for a real debate (the bug: currentModel was "")', () => {
    const debate = { speaker_models: { skeptic: 'moonshot-kimi-k3' } };
    expect(resolveBriefModel(debate, 'skeptic', FALLBACK)).not.toBe('');
  });
});
