// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3594 seam tests: proves that extractTopicScope emits per-field WARNs
// when demanded array fields are absent or wrong-type, and that the sparse
// check now includes relevant_disciplines.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TopicPipeline } from './topicPipeline.js';
import type { TopicPipelineContext } from './topicPipeline.js';
import { FlightRecorder } from '../flight-recorder/flightRecorder.js';
import { setGlobalRecorder, clearGlobalRecorder } from '../flight-recorder/index.js';
import type { DebateSession } from './types.js';

function makeCtx(generateReturn: string): TopicPipelineContext & { warns: string[] } {
  const warns: string[] = [];
  const session = {
    topic: { final: 'test topic', scope: undefined },
  } as unknown as DebateSession;

  return {
    session,
    config: {} as any,
    adapter: {} as any,
    taxonomy: { accelerationist: { nodes: [] }, safetyist: { nodes: [] }, skeptic: { nodes: [] } } as any,
    generate: async () => generateReturn,
    generateViaUsage: async () => generateReturn,
    generateWithModel: async () => generateReturn,
    resolveStageModel: () => 'test-model',
    addEntry: (e) => ({ ...e, id: 'test-id', timestamp: 0 }) as any,
    recordDiagnostic: () => {},
    progress: () => {},
    warn: (_op, _err, msg) => { warns.push(msg); },
    warns,
  };
}

describe('extractTopicScope — absent-field WARNs (t/3594)', () => {
  let recorder: FlightRecorder;

  beforeEach(() => {
    recorder = new FlightRecorder({ capacity: 64 });
    setGlobalRecorder(recorder);
  });

  afterEach(() => {
    clearGlobalRecorder();
  });

  it('emits per-field warn events when demanded arrays are absent', async () => {
    // Model returns a valid object but all demanded arrays are missing
    const ctx = makeCtx(JSON.stringify({ core_proposition: 'test', constraint_confidence: 'explicit' }));
    await new TopicPipeline(ctx).extractTopicScope();

    const warnEvents = recorder.buffer.drain().filter(
      e => e.type === 'system.error' && (e as any).level === 'warn' &&
           (e as any).message === 'Topic scope field absent or wrong type — coerced to []'
    );
    const warnedFields = warnEvents.map(e => (e as any).data?.field as string);

    expect(warnedFields).toContain('relevant_disciplines');
    expect(warnedFields).toContain('off_scope_topics');
    expect(warnedFields).toContain('drift_signatures');
    expect(warnedFields).toContain('on_scope_evidence');
    expect(warnedFields).toContain('key_tensions');
  });

  it('includes rawType in the warn event', async () => {
    const ctx = makeCtx(JSON.stringify({ relevant_disciplines: null }));
    await new TopicPipeline(ctx).extractTopicScope();

    const ev = recorder.buffer.drain().find(
      e => e.type === 'system.error' && (e as any).data?.field === 'relevant_disciplines'
    );
    expect(ev).toBeDefined();
    expect((ev as any).data?.rawType).toBe('null');
  });

  it('does NOT emit a warn when demanded array is correctly populated', async () => {
    const ctx = makeCtx(JSON.stringify({
      relevant_disciplines: ['AI safety', 'ML'],
      off_scope_topics: ['nuclear', 'bioweapons', 'climate'],
      drift_signatures: ['scope creep', 'topic drift'],
      on_scope_evidence: ['evidence1'],
      key_tensions: ['tension1'],
      constraint_confidence: 'explicit',
    }));
    await new TopicPipeline(ctx).extractTopicScope();

    const warnEvents = recorder.buffer.drain().filter(
      e => e.type === 'system.error' && (e as any).message === 'Topic scope field absent or wrong type — coerced to []'
    );
    expect(warnEvents).toHaveLength(0);
  });

  it('includes relevant_disciplines in the sparse check warning', async () => {
    // Populate off_scope_topics and drift_signatures sufficiently but leave disciplines empty
    const ctx = makeCtx(JSON.stringify({
      relevant_disciplines: [],
      off_scope_topics: ['a', 'b', 'c'],
      drift_signatures: ['x', 'y'],
      on_scope_evidence: [],
      key_tensions: [],
      constraint_confidence: 'explicit',
    }));
    await new TopicPipeline(ctx).extractTopicScope();

    expect(ctx.warns.some(w => w.includes('enforcement may be weak'))).toBe(true);
  });
});
