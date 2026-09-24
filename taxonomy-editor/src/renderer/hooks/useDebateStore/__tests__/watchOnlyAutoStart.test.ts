// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3629: startSeededDebate (explorationSlice.ts) is the third confirmed site from
// Diagnostics' enumeration (t/3629#1, site #5) — a watch-only rerun (no participating
// user on the source debate) must reach opening directly instead of parking in
// clarification. Asserts the TERMINAL phase, not that a function was called.

import { describe, it, expect } from 'vitest';
import './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

function makeExplorationSummary() {
  return {
    version: 1,
    source_debate_id: 'debate-source',
    source_model: 'gemini-flash-lite-latest',
    source_tier: 'basic',
    timestamp: new Date(0).toISOString(),
    topic: { original: 'Test topic', refined: 'Test topic', final: 'Test topic' },
    cruxes: [],
    argument_sketch: { nodes: [], edges: [] },
    recommended_config: {
      max_rounds: 4, argumentation_exit_threshold: 0.65, concluding_exit_threshold: 0.6,
      temperature: 0.7, situation_cap: 15, skip_clarification: true, pacing: 'moderate',
    },
  } as any;
}

describe('startSeededDebate — watch-only rerun reaches opening directly (t/3629)', () => {
  it('reaches opening when the source debate had no participating user', async () => {
    useDebateStore.setState({
      explorationSummary: makeExplorationSummary(),
      explorationSourceId: 'debate-source',
      activeDebate: null, // no current debate ⇒ user_is_pover defaults to false
    });

    const id = await useDebateStore.getState().startSeededDebate();

    expect(id).toBeTruthy();
    const state = useDebateStore.getState();
    expect(state.activeDebate).not.toBeNull();
    expect(state.activeDebate!.phase).toBe('opening');
  });
});
