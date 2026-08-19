// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the shared Brief Export pipeline (t/2837). The four stages are mocked
// — this asserts the ORCHESTRATION the pipeline owns: stage order, the `checking`
// sub-phase, allowOpen threading, artifact assembly (manifest last, as output
// record), warnings aggregation, and hardFailures passthrough (no throw on gate-fail).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('./extract.js', () => ({ extractDeckSpec: vi.fn() }));
vi.mock('./narrate.js', () => ({ narrate: vi.fn() }));
vi.mock('./render/index.js', () => ({ render: vi.fn() }));
vi.mock('./verify.js', () => ({ verify: vi.fn() }));

import { extractDeckSpec } from './extract.js';
import { narrate } from './narrate.js';
import { render } from './render/index.js';
import { verify } from './verify.js';
import { runBriefPipeline } from './pipeline.js';
import type { BriefPipelineInput } from './pipeline.js';
import type { DeckSpec, Narration, AuditManifest } from './types.js';
import type { DebateSession } from '../debate/types.js';
import type { AIAdapter } from '../debate/aiAdapter.js';

const adapter = { generateText: async () => '' } as AIAdapter;

const specFixture = { meta: { id: 'sess-1', title: 'T' } } as unknown as DeckSpec;
const narrationFixture = { narration_mode: 'deterministic' } as unknown as Narration;
const manifestFixture = (over: Partial<AuditManifest> = {}): AuditManifest =>
  ({ warnings: ['mw1'], trace_coverage_pct: 100, verdict_counts: {}, debate_id: 'sess-1', ...over } as AuditManifest);

function baseInput(over: Partial<BriefPipelineInput> = {}): BriefPipelineInput {
  return {
    session: { id: 'sess-1', phase: 'closed' } as unknown as DebateSession,
    preset: 'conference',
    modelId: 'gemini-2.5-flash',
    modelSource: 'Explicit',
    skipNarration: false,
    toolVersions: { 'brief-cli': '1.0' },
    timestamp: '2026-08-19T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (extractDeckSpec as Mock).mockReturnValue(specFixture);
  (narrate as Mock).mockResolvedValue({ narration: narrationFixture });
  (render as Mock).mockResolvedValue({
    pptxBytes: new Uint8Array([1, 2, 3]), htmlDoc: '<html></html>',
    warnings: ['rw1'], slideModels: [],
  });
  (verify as Mock).mockResolvedValue({ manifest: manifestFixture(), hardFailures: [] });
});

describe('runBriefPipeline', () => {
  it('emits the four stages in order (no checking when no checker)', async () => {
    const stages: string[] = [];
    await runBriefPipeline(baseInput(), adapter, s => stages.push(s));
    expect(stages).toEqual(['extracting', 'narrating', 'rendering', 'verifying']);
  });

  it('emits checking after narrating when a checker ran', async () => {
    const stages: string[] = [];
    await runBriefPipeline(baseInput({ checkerModelId: 'checker-x' }), adapter, s => stages.push(s));
    expect(stages).toEqual(['extracting', 'narrating', 'checking', 'rendering', 'verifying']);
  });

  it('does NOT emit checking under skipNarration even with a checker set', async () => {
    const stages: string[] = [];
    await runBriefPipeline(baseInput({ checkerModelId: 'checker-x', skipNarration: true }), adapter, s => stages.push(s));
    expect(stages).not.toContain('checking');
  });

  it('threads allowOpen to extractDeckSpec', async () => {
    await runBriefPipeline(baseInput({ allowOpen: true }), adapter);
    expect(extractDeckSpec).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1' }),
      { allowOpen: true },
    );
  });

  it('assembles artifacts in production order with the manifest last', async () => {
    const result = await runBriefPipeline(baseInput(), adapter);
    expect(result.artifacts.map(a => a.name)).toEqual([
      'deck_spec.json', 'narration.json', 'brief.pptx', 'brief.html', 'audit-manifest.json',
    ]);
    // pptx is the only bytes artifact; the rest carry text.
    const pptx = result.artifacts.find(a => a.name === 'brief.pptx');
    expect(pptx?.bytes).toBeInstanceOf(Uint8Array);
    expect(pptx?.text).toBeUndefined();
  });

  it('aggregates render + manifest warnings', async () => {
    const result = await runBriefPipeline(baseInput(), adapter);
    expect(result.warnings).toEqual(['rw1', 'mw1']);
  });

  it('passes hardFailures through without throwing (verify gate failure)', async () => {
    (verify as Mock).mockResolvedValue({ manifest: manifestFixture(), hardFailures: ['schema invalid'] });
    const result = await runBriefPipeline(baseInput(), adapter);
    expect(result.hardFailures).toEqual(['schema invalid']);
    // manifest artifact still produced on gate failure
    expect(result.artifacts.some(a => a.name === 'audit-manifest.json')).toBe(true);
  });

  it('forwards narration + verify inputs from the pipeline input', async () => {
    await runBriefPipeline(baseInput({ skipNarration: true, checkerModelId: 'c1' }), adapter);
    expect(narrate).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'conference', modelId: 'gemini-2.5-flash', skipNarration: true, checkerModelId: 'c1' }),
      adapter,
    );
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      meta: { toolVersions: { 'brief-cli': '1.0' }, timestamp: '2026-08-19T00:00:00.000Z' },
    }));
  });
});
