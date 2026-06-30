// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { loadFixture, loadAllFixtures } from './index.js';
import type { FixtureName } from './index.js';
import { DebateEngine } from '../../debateEngine.js';
import type { DebateConfig } from '../../debateEngine.js';
import type { ExtendedAIAdapter } from '../../aiAdapter.js';

const FIXTURE_NAMES: FixtureName[] = [
  'pre-synthesis',
  'post-synthesis-p1',
  'post-synthesis-p2',
  'post-synthesis-p3',
  'pre-finalization',
];

function createStubAdapter(): ExtendedAIAdapter {
  return {
    async generateText() {
      return JSON.stringify({
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], argument_map: [{ id: 'a1', claim: 'test' }],
        preferences: [{ conflict: 'x', prevails: 'y', criterion: 'z', rationale: 'r' }],
      });
    },
  };
}

function createMinimalTaxonomy() {
  return {
    nodes: [],
    edges: [],
    povs: { accelerationist: [], safetyist: [], skeptic: [], cross_cutting: [] },
    situations: [],
    policyActions: [],
    policyRegistry: [],
  };
}

describe('Checkpoint fixtures', () => {
  describe('loadFixture validates each fixture', () => {
    for (const name of FIXTURE_NAMES) {
      it(`loads '${name}' without error`, () => {
        const session = loadFixture(name);
        expect(session.id).toContain('fixture-');
        expect(session.transcript.length).toBeGreaterThanOrEqual(3);
        expect(session.diagnostics?.overview).toBeDefined();
        expect(session.argument_network?.nodes.length).toBeGreaterThanOrEqual(5);
        expect(session.argument_network?.edges.length).toBeGreaterThanOrEqual(3);
      });
    }
  });

  it('loadAllFixtures returns all 5 fixtures', () => {
    const all = loadAllFixtures();
    expect(Object.keys(all)).toHaveLength(5);
    for (const name of FIXTURE_NAMES) {
      expect(all[name]).toBeDefined();
      expect(all[name].id).toContain('fixture-');
    }
  });

  describe('phase validation catches copy-paste drift', () => {
    it('session.phase matches expected value for each fixture', () => {
      for (const name of FIXTURE_NAMES) {
        const session = loadFixture(name);
        expect(session.phase).toBe('debate');
      }
    });
  });

  describe('synthesis content is progressively populated', () => {
    it('pre-synthesis has no synthesis metadata', () => {
      const session = loadFixture('pre-synthesis');
      const synthEntry = session.transcript.find(
        e => e.type === 'concluding' && (e.metadata as Record<string, unknown> | undefined)?.['synthesis'],
      );
      expect(synthEntry).toBeUndefined();
    });

    it('post-synthesis-p1 has extract data only', () => {
      const session = loadFixture('post-synthesis-p1');
      const synth = getSynthesis(session);
      expect(synth.areas_of_agreement).toBeDefined();
      expect(synth.areas_of_disagreement).toBeDefined();
      expect(synth.argument_map).toBeUndefined();
      expect(synth.preferences).toBeUndefined();
    });

    it('post-synthesis-p2 has extract + map data', () => {
      const session = loadFixture('post-synthesis-p2');
      const synth = getSynthesis(session);
      expect(synth.areas_of_agreement).toBeDefined();
      expect(synth.argument_map).toBeDefined();
      expect(synth.preferences).toBeUndefined();
    });

    it('post-synthesis-p3 has all synthesis data', () => {
      const session = loadFixture('post-synthesis-p3');
      const synth = getSynthesis(session);
      expect(synth.areas_of_agreement).toBeDefined();
      expect(synth.argument_map).toBeDefined();
      expect(synth.preferences).toBeDefined();
    });
  });

  describe('pre-finalization includes post-synthesis pass results', () => {
    it('has missing_arguments', () => {
      const session = loadFixture('pre-finalization');
      expect(session.missing_arguments).toBeDefined();
      expect(session.missing_arguments!.length).toBeGreaterThanOrEqual(1);
    });

    it('has taxonomy_suggestions', () => {
      const session = loadFixture('pre-finalization');
      expect(session.taxonomy_suggestions).toBeDefined();
      expect(session.taxonomy_suggestions!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('fixtures are loadable by DebateEngine.resume()', () => {
    it('pre-synthesis checkpoint resumes with synthesis-p1 stop', async () => {
      const session = loadFixture('pre-synthesis');
      const config: DebateConfig = {
        model: 'test-model',
        topic: session.topic.final,
        stopAfterStage: 'synthesis-p1',
      };
      const result = await DebateEngine.resume(
        session, config, createStubAdapter(), createMinimalTaxonomy(),
      );
      expect(result.id).toBe('fixture-pre-synthesis');
      expect(result.diagnostics?.overview.total_elapsed_ms).toBeGreaterThanOrEqual(0);
    });

    it('post-synthesis-p3 checkpoint resumes with synthesis-p3 stop (already synthesized)', async () => {
      const session = loadFixture('post-synthesis-p3');
      const config: DebateConfig = {
        model: 'test-model',
        topic: session.topic.final,
        stopAfterStage: 'synthesis-p3',
      };
      const result = await DebateEngine.resume(
        session, config, createStubAdapter(), createMinimalTaxonomy(),
      );
      expect(result.id).toBe('fixture-post-synthesis-p3');
      expect(result.diagnostics?.overview.total_elapsed_ms).toBeGreaterThanOrEqual(0);
    });
  });
});

function getSynthesis(session: ReturnType<typeof loadFixture>): Record<string, unknown> {
  const entry = session.transcript.find(
    e => e.type === 'concluding' && (e.metadata as Record<string, unknown> | undefined)?.['synthesis'],
  );
  return ((entry?.metadata as Record<string, unknown> | undefined)?.['synthesis'] as Record<string, unknown>) ?? {};
}
