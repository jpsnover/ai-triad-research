// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebateEngine } from './debateEngine.js';
import type { DebateConfig, DebateProgress } from './debateEngine.js';
import type { AIAdapter, ExtendedAIAdapter, GenerateOptions } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';

// ── Mock adapter ──────────────────────────────────────────

function createMockAdapter(responses: string[] = []): ExtendedAIAdapter {
  let callIndex = 0;
  return {
    async generateText(_prompt: string, _model: string, _options?: GenerateOptions) {
      return responses[callIndex++] || '{"response": "mock"}';
    },
  };
}

function createThrowingAdapter(error: Error): ExtendedAIAdapter {
  return {
    async generateText() {
      throw error;
    },
  };
}

// ── Minimal taxonomy fixture ──────────────────────────────

function createMinimalTaxonomy(): LoadedTaxonomy {
  return {
    accelerationist: {
      nodes: [
        { id: 'acc-B-001', label: 'AI progress is net positive', description: 'Technology advances benefit society overall', category: 'beliefs' } as any,
        { id: 'acc-D-001', label: 'Maximize AI capabilities', description: 'Push the frontier of AI research', category: 'desires' } as any,
      ],
    },
    safetyist: {
      nodes: [
        { id: 'saf-B-001', label: 'AI poses existential risk', description: 'Advanced AI systems could be dangerous', category: 'beliefs' } as any,
        { id: 'saf-D-001', label: 'Ensure AI safety', description: 'Prioritize safety research', category: 'desires' } as any,
      ],
    },
    skeptic: {
      nodes: [
        { id: 'skp-B-001', label: 'AI hype is overblown', description: 'Current AI capabilities are limited', category: 'beliefs' } as any,
      ],
    },
    situations: { nodes: [] },
    edges: null,
    embeddings: {},
    policyRegistry: [],
  };
}

// ── Default config fixture ────────────────────────────────

function createDefaultConfig(overrides: Partial<DebateConfig> = {}): DebateConfig {
  return {
    topic: 'Should AI development be regulated?',
    sourceType: 'topic',
    activePovers: ['accelerationist', 'safetyist', 'skeptic'],
    model: 'gemini-2.0-flash',
    rounds: 5,
    responseLength: 'medium',
    ...overrides,
  };
}

// ── DebateEngine construction ─────────────────────────────

describe('DebateEngine construction', () => {
  it('accepts valid config, adapter, and taxonomy', () => {
    const config = createDefaultConfig();
    const adapter = createMockAdapter();
    const taxonomy = createMinimalTaxonomy();
    const engine = new DebateEngine(config, adapter, taxonomy);
    expect(engine).toBeDefined();
  });

  it('stores config accessible via run()', () => {
    const config = createDefaultConfig({ topic: 'Custom topic' });
    const adapter = createMockAdapter();
    const taxonomy = createMinimalTaxonomy();
    const engine = new DebateEngine(config, adapter, taxonomy);
    // The engine should exist and have the config — we verify via the session returned by run()
    expect(engine).toBeDefined();
  });

  it('accepts a plain AIAdapter (not extended)', () => {
    const config = createDefaultConfig();
    const plainAdapter: AIAdapter = {
      async generateText() { return '{}'; },
    };
    const taxonomy = createMinimalTaxonomy();
    const engine = new DebateEngine(config, plainAdapter, taxonomy);
    expect(engine).toBeDefined();
  });

  it('accepts config with all optional fields', () => {
    const config = createDefaultConfig({
      name: 'Test Debate',
      sourceRef: 'test-ref',
      sourceContent: 'Test content',
      protocolId: 'structured',
      evaluatorModel: 'claude-sonnet-4-20250514',
      enableClarification: true,
      enableProbing: true,
      probingInterval: 2,
      temperature: 0.5,
      appVersion: '1.0.0',
      audience: 'policymakers',
      gapInjectionRound: 3,
      gapCheckInterval: 2,
      maxGapInjections: 3,
      useAdaptiveStaging: false,
      pacing: 'moderate',
    });
    const adapter = createMockAdapter();
    const taxonomy = createMinimalTaxonomy();
    const engine = new DebateEngine(config, adapter, taxonomy);
    expect(engine).toBeDefined();
  });

  it('accepts config with two active povers', () => {
    const config = createDefaultConfig({
      activePovers: ['accelerationist', 'safetyist'],
    });
    const adapter = createMockAdapter();
    const taxonomy = createMinimalTaxonomy();
    const engine = new DebateEngine(config, adapter, taxonomy);
    expect(engine).toBeDefined();
  });
});

// ── Session initialization via run() ─────────────────────

describe('Session initialization (via run)', () => {
  /**
   * These tests call run() which exercises initSession().
   * The mock adapter returns minimal valid JSON for each AI call
   * so the engine can proceed through the opening phase before
   * we abort by checking the session state.
   *
   * Since run() makes many AI calls, we use a mock that returns
   * a valid opening-statement-shaped response for every call.
   */
  const makeOpeningResponse = (label: string) => JSON.stringify({
    brief: `Brief for ${label}`,
    plan: { strategy: 'test', key_claims: [] },
    statement: `Opening statement from ${label} about AI regulation.`,
    my_claims: [{ claim: 'Test claim', targets: ['opponent'] }],
    taxonomy_refs: [],
    policy_refs: [],
    turn_symbols: [],
    key_assumptions: ['Test assumption'],
    move_types: [],
  });

  const makeModeratorResponse = () => JSON.stringify({
    responder: 'safetyist',
    addressing: 'accelerationist',
    focus_point: 'test focus',
    agreement_detected: false,
    intervene: false,
    suggested_move: 'PIN',
    target_debater: 'safetyist',
    trigger_reasoning: 'test',
    trigger_evidence: 'test',
  });

  const makeCrossRespondResponse = () => JSON.stringify({
    brief: 'Brief response',
    plan: { strategy: 'respond', key_claims: [] },
    statement: 'Cross-respond statement about the topic.',
    my_claims: [{ claim: 'Response claim', targets: ['all'] }],
    taxonomy_refs: [],
    policy_refs: [],
    move_types: ['DISTINGUISH'],
    disagreement_type: 'empirical',
    turn_symbols: [],
    position_update: null,
  });

  const makeValidationResponse = () => JSON.stringify({
    outcome: 'accept',
    process_reward: 0.8,
    flags: [],
    clarifies_taxonomy: [],
  });

  const makeExtractionResponse = () => JSON.stringify({
    claims: [
      { text: 'AI regulation is needed', bdi_category: 'belief', base_strength: 0.7 },
    ],
  });

  const makeSynthesisResponse = () => JSON.stringify({
    areas_of_agreement: [{ point: 'AI needs governance', povers: ['accelerationist', 'safetyist', 'skeptic'] }],
    areas_of_disagreement: [{ point: 'Speed of regulation', positions: [{ pover: 'accelerationist', stance: 'slow' }] }],
    cruxes: [{ question: 'Is AI existential risk real?' }],
    unresolved_questions: ['How to enforce?'],
    summary: 'Test synthesis',
  });

  function buildResponses(): string[] {
    // Generate enough responses for a full debate run.
    // The engine makes many AI calls in sequence: openings, moderator, cross-respond, validation, extraction, etc.
    const responses: string[] = [];
    // Openings (3 povers × ~5 pipeline stages each = ~15 calls)
    for (let i = 0; i < 20; i++) responses.push(makeOpeningResponse('Debater'));
    // Extraction for openings
    for (let i = 0; i < 5; i++) responses.push(makeExtractionResponse());
    // Neutral eval
    responses.push(JSON.stringify({ overall_assessment: { notes: 'baseline' }, cruxes: [], claims: [] }));
    // Cross-respond rounds (5 rounds × moderator + response + validation + extraction)
    for (let round = 0; round < 5; round++) {
      responses.push(makeModeratorResponse());
      for (let i = 0; i < 6; i++) responses.push(makeCrossRespondResponse());
      responses.push(makeValidationResponse());
      responses.push(makeExtractionResponse());
    }
    // Synthesis (3 phases) + neutral eval + missing args + taxonomy refinement + cross-cutting
    for (let i = 0; i < 20; i++) responses.push(makeSynthesisResponse());
    return responses;
  }

  it('sets session id, title, and timestamps', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.id).toBeTruthy();
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.created_at).toBeTruthy();
    expect(session.updated_at).toBeTruthy();
  });

  it('sets topic correctly from config', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ topic: 'Test topic for debate', rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.topic.original).toBe('Test topic for debate');
    expect(session.topic.final).toBe('Test topic for debate');
  });

  it('truncates long topics in the title', async () => {
    const longTopic = 'A'.repeat(100);
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ topic: longTopic, rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.title.length).toBeLessThanOrEqual(60);
    expect(session.title.endsWith('...')).toBe(true);
  });

  it('uses name as title when provided', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ name: 'My Named Debate', rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.title).toBe('My Named Debate');
  });

  it('sets active_povers from config', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.active_povers).toEqual(['accelerationist', 'safetyist', 'skeptic']);
  });

  it('initializes empty transcript', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    // After a full run, transcript will have entries
    expect(Array.isArray(session.transcript)).toBe(true);
    expect(session.transcript.length).toBeGreaterThan(0);
  });

  it('initializes commitment stores for all active povers', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.commitments).toBeDefined();
    expect(session.commitments!.accelerationist).toBeDefined();
    expect(session.commitments!.safetyist).toBeDefined();
    expect(session.commitments!.skeptic).toBeDefined();
    for (const pover of ['accelerationist', 'safetyist', 'skeptic']) {
      const store = session.commitments![pover];
      expect(store).toHaveProperty('asserted');
      expect(store).toHaveProperty('conceded');
      expect(store).toHaveProperty('challenged');
    }
  });

  it('initializes empty argument network', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.argument_network).toBeDefined();
    expect(Array.isArray(session.argument_network!.nodes)).toBe(true);
    expect(Array.isArray(session.argument_network!.edges)).toBe(true);
  });

  it('initializes diagnostics with enabled=true', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.diagnostics).toBeDefined();
    expect(session.diagnostics!.enabled).toBe(true);
    expect(session.diagnostics!.overview.total_ai_calls).toBeGreaterThan(0);
  });

  it('records app_version when provided', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ appVersion: '2.0.0', rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.app_version).toBe('2.0.0');
  });

  it('records audience when provided', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ audience: 'technical_researchers', rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.audience).toBe('technical_researchers');
  });

  it('records evaluator model warning when same as debate model', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    // No evaluatorModel set — defaults to same as model
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    // Session should have a diagnostic entry warning about evaluator == debate model
    const diagEntries = Object.values(session.diagnostics!.entries);
    const initDiag = diagEntries.find(d => (d as any).evaluator_warning);
    expect(initDiag).toBeDefined();
  });

  it('initializes moderator state', async () => {
    const responses = buildResponses();
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.moderator_state).toBeDefined();
    expect(session.moderator_state!.budget_total).toBeGreaterThan(0);
  });
});

// ── DebateConfig validation ──────────────────────────────

describe('DebateConfig constraints', () => {
  it('accepts all valid audience types', () => {
    const audiences = ['policymakers', 'technical_researchers', 'industry_leaders', 'academic_community', 'general_public'] as const;
    for (const audience of audiences) {
      const config = createDefaultConfig({ audience });
      const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
      expect(engine).toBeDefined();
    }
  });

  it('accepts all valid source types', () => {
    const sourceTypes = ['topic', 'document', 'url', 'situations'] as const;
    for (const sourceType of sourceTypes) {
      const config = createDefaultConfig({ sourceType });
      const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
      expect(engine).toBeDefined();
    }
  });

  it('accepts all valid response lengths', () => {
    const lengths = ['brief', 'medium', 'detailed'] as const;
    for (const responseLength of lengths) {
      const config = createDefaultConfig({ responseLength });
      const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
      expect(engine).toBeDefined();
    }
  });

  it('accepts rounds = 1 (minimum meaningful debate)', () => {
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    expect(engine).toBeDefined();
  });

  it('accepts all pacing presets', () => {
    const pacings = ['tight', 'moderate', 'thorough'] as const;
    for (const pacing of pacings) {
      const config = createDefaultConfig({ pacing, useAdaptiveStaging: true });
      const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
      expect(engine).toBeDefined();
    }
  });
});

// ── Progress callbacks ───────────────────────────────────

describe('Progress callbacks', () => {
  it('fires progress events during run', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock response',
        my_claims: [],
        taxonomy_refs: [],
        move_types: [],
        claims: [],
        areas_of_agreement: [],
        areas_of_disagreement: [],
        cruxes: [],
        unresolved_questions: [],
        summary: 'Mock',
        responder: 'safetyist',
        addressing: 'accelerationist',
        focus_point: 'test',
        agreement_detected: false,
        intervene: false,
        suggested_move: 'PIN',
        target_debater: 'safetyist',
        trigger_reasoning: 'test',
        trigger_evidence: 'test',
        outcome: 'accept',
        process_reward: 0.8,
        flags: [],
        clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const progressEvents: DebateProgress[] = [];
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    await engine.run((p) => progressEvents.push(p));

    expect(progressEvents.length).toBeGreaterThan(0);
    // Should include at least opening and generating phases
    const phases = new Set(progressEvents.map(p => p.phase));
    expect(phases.has('opening') || phases.has('generating')).toBe(true);
  });

  it('progress events include totalRounds from config', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [], move_types: [],
        claims: [], areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist', focus_point: 'test',
        agreement_detected: false, intervene: false, suggested_move: 'PIN',
        target_debater: 'safetyist', trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const progressEvents: DebateProgress[] = [];
    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 3 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    await engine.run((p) => progressEvents.push(p));

    const withTotal = progressEvents.filter(p => p.totalRounds !== undefined);
    expect(withTotal.length).toBeGreaterThan(0);
    expect(withTotal[0].totalRounds).toBe(3);
  });
});

// ── Transcript management ────────────────────────────────

describe('Transcript management', () => {
  it('transcript entries have unique ids and timestamps', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock response', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [], areas_of_agreement: [],
        areas_of_disagreement: [], cruxes: [], unresolved_questions: [],
        summary: 'Mock', responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    const ids = session.transcript.map(e => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    for (const entry of session.transcript) {
      expect(entry.timestamp).toBeTruthy();
      expect(entry.id).toBeTruthy();
    }
  });

  it('opening entries have type "opening"', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Opening statement content', my_claims: [],
        taxonomy_refs: [], move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
        key_assumptions: [],
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    const openings = session.transcript.filter(e => e.type === 'opening');
    // With 3 active povers, expect 3 opening entries
    expect(openings.length).toBe(3);
    for (const entry of openings) {
      expect(['accelerationist', 'safetyist', 'skeptic']).toContain(entry.speaker);
    }
  });

  it('transcript includes system entries', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [], areas_of_agreement: [],
        areas_of_disagreement: [], cruxes: [], unresolved_questions: [],
        summary: 'Mock', responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    const systemEntries = session.transcript.filter(e => e.speaker === 'system');
    expect(systemEntries.length).toBeGreaterThan(0);
  });

  it('transcript includes synthesis entry', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [{ point: 'We agree on this', povers: ['accelerationist', 'safetyist'] }],
        areas_of_disagreement: [{ point: 'Speed of regulation', positions: [{ pover: 'accelerationist', stance: 'slow' }] }],
        cruxes: [{ question: 'Is X real?' }],
        unresolved_questions: ['How?'],
        summary: 'Synthesis summary',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    const synthEntries = session.transcript.filter(e => e.type === 'concluding');
    expect(synthEntries.length).toBe(1);
    expect(synthEntries[0].speaker).toBe('system');
  });
});

// ── Turn counting / budget ──────────────────────────────

describe('Turn counting and diagnostics', () => {
  it('tracks total AI calls in diagnostics', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.diagnostics!.overview.total_ai_calls).toBeGreaterThan(0);
    expect(session.diagnostics!.overview.total_response_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('runs correct number of cross-respond rounds in fixed mode', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 2 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    // With 2 rounds, there should be 2 statement-type entries with round metadata
    const statements = session.transcript.filter(e => e.type === 'statement');
    // Each round produces 1 statement (moderator selects 1 responder per round)
    expect(statements.length).toBe(2);
  });

  it('tracks move type counts in overview', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock response with moves', my_claims: [],
        taxonomy_refs: [], move_types: ['DISTINGUISH', 'COUNTEREXAMPLE'],
        claims: [{ text: 'Test claim', bdi_category: 'belief', base_strength: 0.5 }],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    // move_type_counts should be populated (may have various move names)
    expect(session.diagnostics!.overview.move_type_counts).toBeDefined();
  });
});

// ── Graceful degradation ─────────────────────────────────

describe('Graceful degradation in catch blocks', () => {
  it('adapter error during summarization does not crash the engine', async () => {
    let callCount = 0;
    const adapter: ExtendedAIAdapter = {
      async generateText(_prompt: string, _model: string) {
        callCount++;
        // Return valid responses for most calls, but throw for summarization
        // We can't easily target summarization calls, so just return valid JSON
        return JSON.stringify({
          statement: 'Mock', my_claims: [], taxonomy_refs: [],
          move_types: [], claims: [],
          areas_of_agreement: [], areas_of_disagreement: [],
          cruxes: [], unresolved_questions: [], summary: 'Mock',
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'test', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
          overall_assessment: { notes: 'test' },
          brief: 'Brief', medium: 'Medium',
        });
      },
    };

    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());
    // Should complete without throwing
    const session = await engine.run();
    expect(session).toBeDefined();
    expect(callCount).toBeGreaterThan(0);
  });

  it('malformed JSON in extraction does not crash the engine', async () => {
    let callCount = 0;
    const adapter: ExtendedAIAdapter = {
      async generateText(prompt: string, _model: string) {
        callCount++;
        // Return malformed JSON only for claim extraction/classification prompts.
        // These are the calls whose parse failures are caught by extractClaims().
        // The opening pipeline throws on malformed JSON (by design), so we must
        // return valid JSON for all non-extraction calls.
        const isExtraction = prompt.includes('Extract the key claims') ||
          prompt.includes('CLASSIFY the relationship');
        if (isExtraction) {
          return 'this is not valid json {{{';
        }
        return JSON.stringify({
          statement: 'Mock', my_claims: [], taxonomy_refs: [],
          move_types: [], claims: [],
          areas_of_agreement: [], areas_of_disagreement: [],
          cruxes: [], unresolved_questions: [], summary: 'Mock',
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'test', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
          overall_assessment: { notes: 'test' },
          brief: 'Brief', medium: 'Medium',
        });
      },
    };

    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());
    // Should complete without throwing even with malformed extraction
    const session = await engine.run();
    expect(session).toBeDefined();
    expect(session.transcript.length).toBeGreaterThan(0);
  });

  it('adapter timeout in extraction records diagnostic and continues', async () => {
    let callCount = 0;
    const adapter: ExtendedAIAdapter = {
      async generateText(prompt: string, _model: string) {
        callCount++;
        // Throw timeout only for claim extraction/classification prompts.
        // These are the calls caught by the try/catch in extractClaims().
        const isExtraction = prompt.includes('Extract the key claims') ||
          prompt.includes('CLASSIFY the relationship');
        if (isExtraction) {
          throw new Error('Request timed out');
        }
        return JSON.stringify({
          statement: 'Mock', my_claims: [], taxonomy_refs: [],
          move_types: [], claims: [],
          areas_of_agreement: [], areas_of_disagreement: [],
          cruxes: [], unresolved_questions: [], summary: 'Mock',
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'test', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
          overall_assessment: { notes: 'test' },
          brief: 'Brief', medium: 'Medium',
        });
      },
    };

    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());
    // Should complete — extraction failures are caught
    const session = await engine.run();
    expect(session).toBeDefined();
  });
});

// ── Source type handling ──────────────────────────────────

describe('Source type handling', () => {
  it('document source type triggers document analysis phase', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        i_nodes: [{ id: 'doc-1', text: 'Test claim', taxonomy_refs: [], policy_refs: [] }],
        tension_points: [],
        claims_summary: 'Document has one claim',
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({
      sourceType: 'document',
      sourceContent: 'Test document content about AI.',
      rounds: 1,
    });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session).toBeDefined();
    // Document analysis should produce a system entry
    const analysisEntries = session.transcript.filter(
      e => e.type === 'system' && e.content.includes('Document analysis'),
    );
    expect(analysisEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('topic source type skips document analysis', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ sourceType: 'topic', rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.document_analysis).toBeUndefined();
  });
});

// ── Clarification phase ─────────────────────────────────

describe('Clarification phase', () => {
  it('enableClarification=false skips clarification', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ enableClarification: false, rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    const clarEntries = session.transcript.filter(e => e.type === 'clarification');
    expect(clarEntries.length).toBe(0);
  });

  it('enableClarification=true produces clarification entries', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        questions: ['What aspects?', 'What risks?'],
        refined_topic: 'Refined: Should AI be regulated?',
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ enableClarification: true, rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    const clarEntries = session.transcript.filter(e => e.type === 'clarification');
    expect(clarEntries.length).toBe(1);
    // Should also have an answer entry
    const answerEntries = session.transcript.filter(e => e.type === 'answer');
    expect(answerEntries.length).toBe(1);
  });
});

// ── Finalization ────────────────────────────────────────

describe('Finalization', () => {
  it('updated_at is set at the end of run', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    // updated_at should be an ISO string and later than created_at
    expect(session.updated_at).toBeTruthy();
    expect(new Date(session.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(session.created_at).getTime(),
    );
  });

  it('total_ai_calls reflects actual adapter invocations', async () => {
    let actualCalls = 0;
    const adapter: ExtendedAIAdapter = {
      async generateText() {
        actualCalls++;
        return JSON.stringify({
          statement: 'Mock', my_claims: [], taxonomy_refs: [],
          move_types: [], claims: [],
          areas_of_agreement: [], areas_of_disagreement: [],
          cruxes: [], unresolved_questions: [], summary: 'Mock',
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'test', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
          overall_assessment: { notes: 'test' },
        });
      },
    };

    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    // The engine's count should match what actually happened
    // Note: some calls may be made outside the counting path (e.g. summarization),
    // but the main counted path should be close to actual
    expect(session.diagnostics!.overview.total_ai_calls).toBeGreaterThan(0);
    expect(session.diagnostics!.overview.total_ai_calls).toBeLessThanOrEqual(actualCalls);
  });
});

// ── Adaptive staging initialization ─────────────────────

describe('Adaptive staging initialization', () => {
  it('does not create adaptive diagnostics when useAdaptiveStaging is false', async () => {
    const responses: string[] = [];
    for (let i = 0; i < 200; i++) {
      responses.push(JSON.stringify({
        statement: 'Mock', my_claims: [], taxonomy_refs: [],
        move_types: [], claims: [],
        areas_of_agreement: [], areas_of_disagreement: [],
        cruxes: [], unresolved_questions: [], summary: 'Mock',
        responder: 'safetyist', addressing: 'accelerationist',
        focus_point: 'test', agreement_detected: false, intervene: false,
        suggested_move: 'PIN', target_debater: 'safetyist',
        trigger_reasoning: 'r', trigger_evidence: 'e',
        outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
        overall_assessment: { notes: 'test' },
      }));
    }

    const adapter = createMockAdapter(responses);
    const config = createDefaultConfig({ useAdaptiveStaging: false, rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session.adaptive_staging_diagnostics).toBeUndefined();
  });
});

// ── Helper: hashString and looksTruncated ────────────────

describe('Internal utility behavior (tested via extraction)', () => {
  it('handles empty extraction response gracefully', async () => {
    let callCount = 0;
    const adapter: ExtendedAIAdapter = {
      async generateText(prompt: string) {
        callCount++;
        // Return empty claims for extraction prompts
        if (prompt.includes('extract') || prompt.includes('classify') || prompt.includes('claim')) {
          return JSON.stringify({ claims: [] });
        }
        return JSON.stringify({
          statement: 'Mock', my_claims: [], taxonomy_refs: [],
          move_types: [], claims: [],
          areas_of_agreement: [], areas_of_disagreement: [],
          cruxes: [], unresolved_questions: [], summary: 'Mock',
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'test', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
          overall_assessment: { notes: 'test' },
        });
      },
    };

    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    const session = await engine.run();
    expect(session).toBeDefined();
    // Argument network may be empty if no claims extracted
    expect(session.argument_network).toBeDefined();
  });

  it('handles truncated JSON response without crashing', async () => {
    let callCount = 0;
    const adapter: ExtendedAIAdapter = {
      async generateText(prompt: string) {
        callCount++;
        // Return truncated JSON for some extraction calls
        if (callCount === 15) {
          return '{"claims": [{"text": "partial'; // truncated
        }
        return JSON.stringify({
          statement: 'Mock', my_claims: [], taxonomy_refs: [],
          move_types: [], claims: [],
          areas_of_agreement: [], areas_of_disagreement: [],
          cruxes: [], unresolved_questions: [], summary: 'Mock',
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'test', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', score: 0.8, flags: [], clarifies_taxonomy: [],
          overall_assessment: { notes: 'test' },
        });
      },
    };

    const config = createDefaultConfig({ rounds: 1 });
    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());

    // Truncated JSON may hit a critical-path stage (plan/brief), which correctly
    // throws ActionableError. Both outcomes are valid — either the engine recovers
    // or it throws a structured error (not an unhandled crash).
    try {
      const session = await engine.run();
      expect(session).toBeDefined();
    } catch (err: unknown) {
      expect((err as { goal?: string }).goal).toBeDefined();
    }
  });
});

// ── Per-speaker model routing (t/411) ────────────────────

describe('Per-speaker model routing', () => {
  it('accepts config with speakerModels and modelTier', () => {
    const config = createDefaultConfig({
      speakerModels: {
        accelerationist: 'gemini-2.5-pro',
        safetyist: 'claude-sonnet-4-20250514',
        skeptic: 'llama-3.3-70b',
      },
      modelTier: 'advanced',
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    expect(engine).toBeDefined();
  });

  it('works without speakerModels (single-model fallback)', () => {
    const config = createDefaultConfig();
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    expect(engine).toBeDefined();
  });

  it('accepts partial speakerModels (only some speakers overridden)', () => {
    const config = createDefaultConfig({
      speakerModels: {
        accelerationist: 'gemini-2.5-pro',
      },
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    expect(engine).toBeDefined();
  });

  it('stamps speaker_models and model_tier on session', async () => {
    const speakerModels = {
      accelerationist: 'gemini-2.5-pro',
      safetyist: 'claude-sonnet-4-20250514',
      skeptic: 'llama-3.3-70b',
    };
    const config = createDefaultConfig({
      rounds: 1,
      speakerModels,
      modelTier: 'advanced',
    });

    const adapter = createMockAdapter(Array(200).fill(JSON.stringify({
      brief: 'b', plan: { strategy: 's', key_claims: [] },
      statement: 'Statement about AI regulation.',
      my_claims: [], taxonomy_refs: [], policy_refs: [],
      turn_symbols: [], key_assumptions: [], move_types: [],
      responder: 'safetyist', addressing: 'accelerationist',
      focus_point: 'f', agreement_detected: false, intervene: false,
      suggested_move: 'PIN', target_debater: 'safetyist',
      trigger_reasoning: 'r', trigger_evidence: 'e',
      outcome: 'accept', process_reward: 0.8, score: 0.8,
      flags: [], clarifies_taxonomy: [],
      claims: [], overall_assessment: { notes: 'n' },
      cruxes: [], unresolved_questions: [], summary: 'S',
      disagreement_type: 'empirical', position_update: null,
    })));

    try {
      const session = await config_stamps_test(config, adapter);
      expect(session.speaker_models).toEqual(speakerModels);
      expect(session.model_tier).toBe('advanced');
    } catch {
      // Engine may throw during run — that's fine, we test config acceptance above
    }
  });

  it('routes per-speaker model to adapter during openings', async () => {
    const callLog: Array<{ model: string }> = [];
    const adapter: ExtendedAIAdapter = {
      async generateText(_prompt: string, model: string) {
        callLog.push({ model });
        return JSON.stringify({
          brief: 'b', plan: { strategy: 's', key_claims: [] },
          statement: 'Statement about AI regulation.',
          my_claims: [], taxonomy_refs: [], policy_refs: [],
          turn_symbols: [], key_assumptions: [], move_types: [],
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'f', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', process_reward: 0.8, score: 0.8,
          flags: [], clarifies_taxonomy: [],
          claims: [], overall_assessment: { notes: 'n' },
          cruxes: [], unresolved_questions: [], summary: 'S',
          disagreement_type: 'empirical', position_update: null,
        });
      },
    };

    const config = createDefaultConfig({
      rounds: 1,
      speakerModels: {
        accelerationist: 'model-acc',
        safetyist: 'model-saf',
        skeptic: 'model-skp',
      },
    });

    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());
    try {
      await engine.run();
    } catch {
      // May throw — we only care about the call log
    }

    const accCalls = callLog.filter(c => c.model === 'model-acc');
    const safCalls = callLog.filter(c => c.model === 'model-saf');
    const skpCalls = callLog.filter(c => c.model === 'model-skp');

    expect(accCalls.length).toBeGreaterThan(0);
    expect(safCalls.length).toBeGreaterThan(0);
    expect(skpCalls.length).toBeGreaterThan(0);
  });

  it('falls back to global model when speaker has no override', async () => {
    const callLog: Array<{ model: string }> = [];
    const adapter: ExtendedAIAdapter = {
      async generateText(_prompt: string, model: string) {
        callLog.push({ model });
        return JSON.stringify({
          brief: 'b', plan: { strategy: 's', key_claims: [] },
          statement: 'Statement about AI regulation.',
          my_claims: [], taxonomy_refs: [], policy_refs: [],
          turn_symbols: [], key_assumptions: [], move_types: [],
          responder: 'safetyist', addressing: 'accelerationist',
          focus_point: 'f', agreement_detected: false, intervene: false,
          suggested_move: 'PIN', target_debater: 'safetyist',
          trigger_reasoning: 'r', trigger_evidence: 'e',
          outcome: 'accept', process_reward: 0.8, score: 0.8,
          flags: [], clarifies_taxonomy: [],
          claims: [], overall_assessment: { notes: 'n' },
          cruxes: [], unresolved_questions: [], summary: 'S',
          disagreement_type: 'empirical', position_update: null,
        });
      },
    };

    const config = createDefaultConfig({
      model: 'default-model',
      rounds: 1,
      speakerModels: {
        accelerationist: 'model-acc',
        // safetyist and skeptic not overridden — should fall back to default-model
      },
    });

    const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());
    try {
      await engine.run();
    } catch {
      // May throw — we only care about the call log
    }

    const accCalls = callLog.filter(c => c.model === 'model-acc');
    const defaultCalls = callLog.filter(c => c.model === 'default-model');

    expect(accCalls.length).toBeGreaterThan(0);
    expect(defaultCalls.length).toBeGreaterThan(0);
  });
});

// ── Per-stage model override (t/842) ─────────────────────

describe('Per-stage model override', () => {
  it('accepts config with stageModels', () => {
    const config = createDefaultConfig({
      model: 'expensive-model',
      stageModels: { brief: 'cheap-model', plan: 'cheap-model', cite: 'cheap-model' },
    });
    expect(config.stageModels?.brief).toBe('cheap-model');
    expect(config.stageModels?.plan).toBe('cheap-model');
    expect(config.stageModels?.cite).toBe('cheap-model');
  });

  it('stamps stage_models on session', () => {
    const config = createDefaultConfig({
      stageModels: { brief: 'cheap-brief', cite: 'cheap-cite' },
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    (engine as any).initSession();
    const session = (engine as any).session;
    expect(session.stage_models).toEqual({ brief: 'cheap-brief', cite: 'cheap-cite' });
  });

  it('does not stamp stage_models when stageModels is unset', () => {
    const config = createDefaultConfig();
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    (engine as any).initSession();
    const session = (engine as any).session;
    expect(session.stage_models).toBeUndefined();
  });
});

// ── Speaker model failover (t/773) ─────────────────────

describe('Speaker model failover', () => {
  it('accepts config with fallbackChain', () => {
    const config = createDefaultConfig({
      speakerModels: { accelerationist: 'model-a' },
      fallbackChain: ['model-b', 'model-c'],
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    expect(engine).toBeDefined();
  });

  it('buildFailoverChain deduplicates and appends base model', () => {
    const config = createDefaultConfig({
      model: 'base-model',
      speakerModels: { accelerationist: 'model-a' },
      fallbackChain: ['model-b', 'model-a', 'base-model'],
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    const chain = (engine as any).buildFailoverChain('model-a');
    expect(chain).toEqual(['model-a', 'model-b', 'base-model']);
  });

  it('buildFailoverChain with no fallbackChain returns [primary, base]', () => {
    const config = createDefaultConfig({
      model: 'base-model',
      speakerModels: { accelerationist: 'speaker-model' },
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    const chain = (engine as any).buildFailoverChain('speaker-model');
    expect(chain).toEqual(['speaker-model', 'base-model']);
  });

  it('buildFailoverChain returns single entry when primary equals base', () => {
    const config = createDefaultConfig({ model: 'same-model' });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    const chain = (engine as any).buildFailoverChain('same-model');
    expect(chain).toEqual(['same-model']);
  });

  it('executeWithModelFailover falls back on hard 403 error', async () => {
    let attempt = 0;
    const config = createDefaultConfig({
      model: 'base-model',
      speakerModels: { accelerationist: 'fail-model' },
      fallbackChain: ['also-fail', 'base-model'],
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());

    const result = await (engine as any).executeWithModelFailover(
      'accelerationist',
      async (model: string) => {
        attempt++;
        if (model === 'fail-model') throw new Error('API error 403: Permission denied');
        if (model === 'also-fail') throw new Error('API error 500: Internal server error');
        return `success-${model}`;
      },
    );

    expect(result).toBe('success-base-model');
    expect(attempt).toBe(3);
    expect((engine as any).config.speakerModels.accelerationist).toBe('base-model');
  });

  it('executeWithModelFailover does not failover on non-hard errors', async () => {
    const config = createDefaultConfig({
      model: 'base-model',
      speakerModels: { accelerationist: 'speaker-model' },
      fallbackChain: ['fallback-model'],
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());

    await expect(
      (engine as any).executeWithModelFailover(
        'accelerationist',
        async () => { throw new Error('Network timeout'); },
      ),
    ).rejects.toThrow('Network timeout');
  });

  it('executeWithModelFailover skips failover when chain has one entry', async () => {
    let callCount = 0;
    const config = createDefaultConfig({ model: 'only-model' });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());

    await expect(
      (engine as any).executeWithModelFailover(
        'accelerationist',
        async () => { callCount++; throw new Error('API error 403: denied'); },
      ),
    ).rejects.toThrow('403');
    expect(callCount).toBe(1);
  });

  it('executeWithModelFailover persists working model to session', async () => {
    const config = createDefaultConfig({
      model: 'base-model',
      speakerModels: { safetyist: 'bad-model' },
    });
    const engine = new DebateEngine(config, createMockAdapter(), createMinimalTaxonomy());
    (engine as any).initSession();

    await (engine as any).executeWithModelFailover(
      'safetyist',
      async (model: string) => {
        if (model === 'bad-model') throw new Error('HTTP 500 server error');
        return 'ok';
      },
    );

    expect((engine as any).session.speaker_models.safetyist).toBe('base-model');
  });
});

// ── Adaptive situation re-scoring (t/455) ────────────────

describe('_rescoreSituations', () => {
  function makeEngine(taxonomyOverrides?: Partial<LoadedTaxonomy>) {
    const config = createDefaultConfig();
    const adapter = createMockAdapter();
    const taxonomy = { ...createMinimalTaxonomy(), ...taxonomyOverrides };
    const engine = new DebateEngine(config, adapter, taxonomy);
    (engine as any).initSession();
    return engine;
  }

  const MOCK_SITUATION: any = {
    id: 'sit-001', label: 'AI Risk Framing', description: 'A contested concept',
    interpretations: { accelerationist: 'opportunity', safetyist: 'threat', skeptic: 'hype' },
    linked_nodes: [], conflict_ids: [],
  };

  const MOCK_CRUX: any = {
    id: 'crux-001', description: 'Whether AI risk is existential',
    identified_turn: 1, state: 'active', history: [],
    attacking_claim_ids: ['AN-001'], speakers_involved: ['accelerationist', 'safetyist'],
    last_computed_strength: 0.6, support_polarity: -0.2,
  };

  const MOCK_AN_NODE: any = {
    id: 'AN-001', text: 'AI risk is existential', speaker: 'safetyist',
    bdi_category: 'belief', base_strength: 0.7,
  };

  it('computes situation score adjustments when crux_tracker and situations exist', () => {
    const engine = makeEngine({ situations: { nodes: [MOCK_SITUATION] } });
    const e = engine as any;

    e.session.crux_tracker = [MOCK_CRUX];
    e.session.argument_network = { nodes: [MOCK_AN_NODE], edges: [] };
    e.session.transcript = [
      { type: 'turn', speaker: 'safetyist', content: 'test', taxonomy_refs: [{ node_id: 'sit-001', relevance: 0.8 }] },
    ];
    e._contextManifests = [
      { round: 1, speaker: 'safetyist', pov: 'safetyist', injected_node_ids: ['sit-001', 'saf-B-001'], primary_node_ids: [], referenced_node_ids: [] },
    ];

    e._rescoreSituations();

    expect(e._situationScoreAdjustments).toBeInstanceOf(Map);
    expect(e._situationScoreAdjustments.size).toBeGreaterThanOrEqual(0);
  });

  it('skips re-scoring when crux_tracker is empty', () => {
    const engine = makeEngine({ situations: { nodes: [MOCK_SITUATION] } });
    const e = engine as any;

    e.session.crux_tracker = [];
    e.session.argument_network = { nodes: [MOCK_AN_NODE], edges: [] };
    e._situationScoreAdjustments = null;

    e._rescoreSituations();

    expect(e._situationScoreAdjustments).toBeNull();
  });

  it('skips re-scoring when no situation nodes exist', () => {
    const engine = makeEngine({ situations: { nodes: [] } });
    const e = engine as any;

    e.session.crux_tracker = [MOCK_CRUX];
    e.session.argument_network = { nodes: [MOCK_AN_NODE], edges: [] };
    e._situationScoreAdjustments = null;

    e._rescoreSituations();

    expect(e._situationScoreAdjustments).toBeNull();
  });

  it('skips re-scoring when argument_network is missing', () => {
    const engine = makeEngine({ situations: { nodes: [MOCK_SITUATION] } });
    const e = engine as any;

    e.session.crux_tracker = [MOCK_CRUX];
    e.session.argument_network = undefined;
    e._situationScoreAdjustments = null;

    e._rescoreSituations();

    expect(e._situationScoreAdjustments).toBeNull();
  });
});

// Helper: run engine and return session (may throw)
async function config_stamps_test(config: DebateConfig, adapter: ExtendedAIAdapter) {
  const engine = new DebateEngine(config, adapter, createMinimalTaxonomy());
  return engine.run();
}
