// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// StageHarness — lifecycle-level fault injection for debate engine resume().
// Composes checkpoint fixtures (t/1165) with stage-aware adapter proxying.
// FaultHarness (faultInjection.ts) owns fetch-level stubs; StageHarness
// operates one layer up at the adapter/stage level.

import type { DebateSession } from '../types.js';
import type { ExtendedAIAdapter } from '../aiAdapter.js';
import { DebateEngine } from '../debateEngine.js';
import type { LifecycleStage, DebateConfig } from '../debateEngine.js';
import { loadFixture } from './fixtures/index.js';
import type { FixtureName } from './fixtures/index.js';
import { FlightRecorder } from '../../flight-recorder/flightRecorder.js';
import { setGlobalRecorder, getGlobalRecorder, clearGlobalRecorder } from '../../flight-recorder/index.js';
import type { FlightRecorderEvent } from '../../flight-recorder/types.js';

// ── Types ────────────────────────────────────────────────

export type FaultSpec =
  | { type: 'hang' }
  | { type: 'slow'; ms: number }
  | { type: 'malformed-json' }
  | { type: 'throw'; error: Error }
  | { type: 'kill-mid-write' }
  | { type: 'corrupt-serialize' }
  | { type: 'gate-trip'; metric: string; value: number };

export interface StageResult {
  outcome: 'success' | 'error' | 'timeout' | 'partial';
  error?: Error;
  session?: DebateSession;
  checkpoint?: DebateSession;
  flightRecorderEvents: FlightRecorderEvent[];
  durationMs: number;
  adapterCallCount: number;
}

// Stage ordering in resume() pipeline — see debateEngine.ts resume() ~line 942.
// If resume() pipeline changes, update this mapping.
// 'finalization' is omitted — engine makes no adapter calls during that phase.
const STAGE_ORDER: LifecycleStage[] = [
  'synthesis-p1', 'synthesis-p2', 'synthesis-p3',
  'missing-arguments', 'taxonomy-refinement',
  'extraction-coverage',
];

// ── Stub adapter ────────────────────────────────────────

const STUB_RESPONSE = JSON.stringify({
  areas_of_agreement: [],
  areas_of_disagreement: [],
  cruxes: [],
  argument_map: [{ id: 'a1', claim: 'stub' }],
  preferences: [{ conflict: 'x', prevails: 'y', criterion: 'z', rationale: 'r' }],
});

function createStubAdapter(): ExtendedAIAdapter {
  return {
    async generateText() { return STUB_RESPONSE; },
  };
}

// ── Minimal taxonomy ────────────────────────────────────

function createMinimalTaxonomy() {
  return {
    accelerationist: { nodes: [] },
    safetyist: { nodes: [] },
    skeptic: { nodes: [] },
    situations: { nodes: [] },
    edges: null,
    embeddings: {},
    policyRegistry: [],
  };
}

// ── Fault-injecting adapter proxy ───────────────────────

function createFaultProxy(
  base: ExtendedAIAdapter,
  faults: Map<LifecycleStage, FaultSpec>,
  hasSynthesis: boolean,
  callTracker: { count: number },
): ExtendedAIAdapter {
  // Map adapter call indices to lifecycle stages.
  // Pre-synthesis fixture: calls go to synthesis (p1=1, p2=2-3 with retry, p3=4-5+)
  // then missing-arguments, taxonomy-refinement, extraction-coverage.
  // Post-synthesis fixture: synthesis is skipped, calls start at missing-arguments.
  function resolveStage(callIndex: number): LifecycleStage | undefined {
    if (!hasSynthesis) {
      // Pre-synthesis: calls 1-3 are synthesis phases, then post-synthesis passes
      if (callIndex <= 1) return 'synthesis-p1';
      if (callIndex <= 3) return 'synthesis-p2';
      if (callIndex <= 5) return 'synthesis-p3';
      if (callIndex <= 6) return 'missing-arguments';
      if (callIndex <= 7) return 'taxonomy-refinement';
      return 'extraction-coverage';
    }
    // Post-synthesis: no synthesis calls
    if (callIndex <= 1) return 'missing-arguments';
    if (callIndex <= 2) return 'taxonomy-refinement';
    return 'extraction-coverage';
  }

  return {
    async generateText(prompt: string, ...rest: unknown[]) {
      callTracker.count++;
      const stage = resolveStage(callTracker.count);

      if (stage) {
        const fault = faults.get(stage);
        if (fault) {
          return applyAdapterFault(fault);
        }
      }

      return base.generateText!(prompt, ...(rest as [string]));
    },
  };
}

async function applyAdapterFault(fault: FaultSpec): Promise<string> {
  switch (fault.type) {
    case 'hang':
      return new Promise<string>(() => {});
    case 'slow':
      return new Promise<string>(resolve =>
        setTimeout(() => resolve(STUB_RESPONSE), fault.ms));
    case 'malformed-json':
      return '{truncated: true, "missing_close';
    case 'throw':
      throw fault.error;
    case 'gate-trip':
      return JSON.stringify({
        areas_of_agreement: [],
        areas_of_disagreement: [],
        cruxes: [],
        argument_map: [{ id: 'a1', claim: 'stub' }],
        preferences: [{ conflict: 'x', prevails: 'y', criterion: 'z', rationale: 'r' }],
        [fault.metric]: fault.value,
      });
    case 'kill-mid-write':
    case 'corrupt-serialize':
      return STUB_RESPONSE;
  }
}

// ── StageHarness ────────────────────────────────────────

export class StageHarness {
  private fixtureName: FixtureName;
  private faults = new Map<LifecycleStage, FaultSpec>();

  constructor(fixture: FixtureName) {
    this.fixtureName = fixture;
  }

  inject(stage: LifecycleStage, fault: FaultSpec): this {
    this.faults.set(stage, fault);
    return this;
  }

  async run(opts?: {
    stopAfterStage?: LifecycleStage;
    timeout?: number;
  }): Promise<StageResult> {
    const timeout = opts?.timeout ?? 10_000;
    const start = Date.now();

    // Set up a flight recorder to capture events during the run
    const recorder = new FlightRecorder({ capacity: 256 });
    const previousRecorder = getGlobalRecorder();
    setGlobalRecorder(recorder);

    const checkpoint = loadFixture(this.fixtureName);
    const hasSynthesis = checkpoint.transcript.some(
      e => e.type === 'concluding' &&
        (e.metadata as Record<string, unknown> | undefined)?.['synthesis'],
    );

    const callTracker = { count: 0 };
    const adapter = createFaultProxy(
      createStubAdapter(), this.faults, hasSynthesis, callTracker,
    );

    const config: DebateConfig = {
      model: 'test-model',
      topic: checkpoint.topic.final,
      stopAfterStage: opts?.stopAfterStage,
    };

    let result: StageResult;

    try {
      const session = await Promise.race([
        DebateEngine.resume(
          checkpoint, config, adapter, createMinimalTaxonomy() as any,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('StageHarness timeout')), timeout)),
      ]);

      // Post-run fault application for persistence faults
      const killWrite = this.findFaultOfType('kill-mid-write');
      const corruptSer = this.findFaultOfType('corrupt-serialize');

      if (killWrite) {
        result = {
          outcome: 'error',
          error: new Error('Simulated write failure during persistence'),
          session: undefined,
          checkpoint: structuredClone(session),
          flightRecorderEvents: recorder.buffer.drain(),
          durationMs: Date.now() - start,
          adapterCallCount: callTracker.count,
        };
      } else if (corruptSer) {
        const corrupted = session as any;
        corrupted._circular = corrupted;
        result = {
          outcome: 'error',
          error: new Error('Simulated serialization corruption'),
          session: undefined,
          checkpoint: structuredClone(checkpoint),
          flightRecorderEvents: recorder.buffer.drain(),
          durationMs: Date.now() - start,
          adapterCallCount: callTracker.count,
        };
        delete corrupted._circular;
      } else {
        result = {
          outcome: 'success',
          session,
          checkpoint: structuredClone(checkpoint),
          flightRecorderEvents: recorder.buffer.drain(),
          durationMs: Date.now() - start,
          adapterCallCount: callTracker.count,
        };
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isTimeout = error.message === 'StageHarness timeout';
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'stageHarness', level: 'error',
        message: isTimeout ? 'StageHarness timeout' : `StageHarness run error: ${error.message}`,
        error: { name: error.name ?? 'Error', message: String(error) },
      });

      result = {
        outcome: isTimeout ? 'timeout' : 'error',
        error,
        checkpoint: structuredClone(checkpoint),
        flightRecorderEvents: recorder.buffer.drain(),
        durationMs: Date.now() - start,
        adapterCallCount: callTracker.count,
      };
    } finally {
      if (previousRecorder) {
        setGlobalRecorder(previousRecorder);
      } else {
        clearGlobalRecorder();
      }
    }

    return result;
  }

  private findFaultOfType(type: FaultSpec['type']): FaultSpec | undefined {
    for (const fault of this.faults.values()) {
      if (fault.type === type) return fault;
    }
    return undefined;
  }
}

export { STAGE_ORDER };
export type { LifecycleStage, FixtureName };
