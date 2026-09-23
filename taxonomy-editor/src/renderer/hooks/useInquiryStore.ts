// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// "Ask a question" store (t/3583). Own lifecycle (ask → poll → result) — deliberately NOT folded
// into useDebateStore, which is session-shaped and has none of this concept.

import { create } from 'zustand';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { deriveDebateConfig } from '@lib/debate/inquiryConfig';
import type { InquiryJobStatus, InquiryResult, InquiryStatusResponse } from '../bridge/types';
import type { Fidelity } from '@lib/inquiry';
import type { ModelRegistry } from '@lib/ai-client/registry';
import aiModelsRegistry from '../../../../ai-models.json';

const registry = aiModelsRegistry as unknown as ModelRegistry;

/** Poll bounds (TL, t/3583#4): interval + backoff on poll errors, and a hard ceiling so a lost
 *  job (server swept it, network partition) doesn't spin forever. */
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_BACKOFF_MS = 30_000;
const POLL_CEILING_MS = 60 * 60_000; // 1 hour — comfortably above Deep fidelity's own ~45 min estimate

export type InquiryScreen = 'ask' | 'running' | 'answer';

interface InquiryStoreState {
  question: string;
  fidelity: Fidelity;
  /** Explicit model overrides (t/3583#2 revision — both pickable on the Ask screen). Undefined = use
   *  the fidelity tier default. */
  debaterModel?: string;
  evaluatorModel?: string;

  jobId: string | null;
  status: InquiryJobStatus | null;
  progressPct: number;
  terminationReason: string | null;
  /** Job-level failure (status === 'failed') — distinct from pollError (TL point 3: poll-error ≠
   *  job-failed). A transient network blip while polling must not read as "the inquiry failed". */
  error: string | null;
  /** Set when a POLL request itself fails (network, 5xx) — surfaced separately from `error` so the
   *  UI can show "still trying to check status" rather than a false failure. Cleared on the next
   *  successful poll. */
  pollError: string | null;
  result: InquiryResult | null;

  setQuestion: (q: string) => void;
  setFidelity: (f: Fidelity) => void;
  setDebaterModel: (m: string | undefined) => void;
  setEvaluatorModel: (m: string | undefined) => void;
  /** The debater/evaluator models this run will actually use — the override if set, else the
   *  fidelity tier default (single source of truth: lib/debate/inquiryConfig's deriveDebateConfig,
   *  same function the server-side pipeline uses to resolve the same request). */
  resolvedModels: () => { debaters: string; evaluator: string; callBudget: number };
  screen: () => InquiryScreen;
  startInquiry: () => Promise<void>;
  /** Returns to the Ask screen for a fresh question. Stops any in-flight poll. */
  reset: () => void;

  /** Internal — exposed for the unmount-cleanup effect in InquiryTab.tsx. */
  _stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollStartedAt = 0;
let consecutivePollFailures = 0;

function clearPollTimer(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export const useInquiryStore = create<InquiryStoreState>((set, get) => {
  function schedulePoll(jobId: string): void {
    clearPollTimer();
    const delay = consecutivePollFailures === 0
      ? POLL_INTERVAL_MS
      : Math.min(POLL_INTERVAL_MS * 2 ** consecutivePollFailures, MAX_POLL_BACKOFF_MS);
    pollTimer = setTimeout(() => void poll(jobId), delay);
  }

  async function poll(jobId: string): Promise<void> {
    // Ceiling: a lost job (swept server-side, or a stuck desktop process) must not poll forever.
    if (performance.now() - pollStartedAt > POLL_CEILING_MS) {
      clearPollTimer();
      set({
        status: 'failed',
        error: 'Timed out waiting for a status update — the inquiry may still be running server-side, but this client gave up polling.',
      });
      return;
    }
    // Stale poll guard: a reset()/new startInquiry() during this poll's flight must not clobber
    // the newer state when this response lands.
    if (get().jobId !== jobId) return;

    let view: InquiryStatusResponse;
    try {
      view = await api.getInquiry(jobId);
    } catch (err) {
      consecutivePollFailures++;
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'inquiry-store',
        level: 'warn',
        message: `Poll failed for inquiry ${jobId} (attempt ${consecutivePollFailures})`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      if (get().jobId === jobId) {
        set({ pollError: err instanceof Error ? err.message : String(err) });
        schedulePoll(jobId);
      }
      return;
    }
    if (get().jobId !== jobId) return; // superseded while this request was in flight

    consecutivePollFailures = 0;
    set({
      status: view.status,
      progressPct: view.progressPct,
      terminationReason: view.terminationReason,
      error: view.status === 'failed' ? view.error : null,
      result: view.result ?? null,
      pollError: null,
    });

    if (view.status === 'done' || view.status === 'done_truncated' || view.status === 'failed') {
      clearPollTimer();
      return;
    }
    schedulePoll(jobId);
  }

  return {
    question: '',
    fidelity: 'standard',
    debaterModel: undefined,
    evaluatorModel: undefined,
    jobId: null,
    status: null,
    progressPct: 0,
    terminationReason: null,
    error: null,
    pollError: null,
    result: null,

    setQuestion: (q) => set({ question: q }),
    setFidelity: (f) => set({ fidelity: f }),
    setDebaterModel: (m) => set({ debaterModel: m }),
    setEvaluatorModel: (m) => set({ evaluatorModel: m }),

    resolvedModels: () => {
      const { fidelity, debaterModel, evaluatorModel } = get();
      const { derivation } = deriveDebateConfig(
        { question: '_', fidelity, models: { debaters: debaterModel, evaluator: evaluatorModel } },
        registry,
      );
      return { debaters: derivation.models.debaters, evaluator: derivation.models.evaluator, callBudget: derivation.callBudget };
    },

    screen: () => {
      const { jobId, status } = get();
      if (jobId === null) return 'ask';
      if (status === 'done' || status === 'done_truncated' || status === 'failed') return 'answer';
      return 'running';
    },

    startInquiry: async () => {
      const { question, fidelity, debaterModel, evaluatorModel } = get();
      set({ error: null, pollError: null, result: null, status: 'queued', progressPct: 0, terminationReason: null });
      try {
        const { jobId } = await api.startInquiry({
          question,
          fidelity,
          models: (debaterModel || evaluatorModel) ? { debaters: debaterModel, evaluator: evaluatorModel } : undefined,
        });
        set({ jobId });
        clearPollTimer();
        consecutivePollFailures = 0;
        pollStartedAt = performance.now();
        void poll(jobId);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'inquiry-store',
          level: 'error',
          message: 'startInquiry failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        set({
          jobId: null,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    reset: () => {
      clearPollTimer();
      consecutivePollFailures = 0;
      set({
        jobId: null, status: null, progressPct: 0, terminationReason: null,
        error: null, pollError: null, result: null,
      });
    },

    _stopPolling: () => { clearPollTimer(); },
  };
});
