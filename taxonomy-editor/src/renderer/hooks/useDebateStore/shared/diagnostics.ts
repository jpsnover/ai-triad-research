// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateSession, EntryDiagnostics, DebateDiagnostics } from '../../../types/debate';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api } from '@bridge';

// ── Adaptive staging signal history ──────────────────────────────────
// Per-round signal values for priorSignals.get() and priorSignals.movingAverage().
// Keyed by signal ID → array of { round, value } entries.
const _signalHistory = new Map<string, { round: number; value: number }[]>();

export function recordSignalHistory(signalId: string, round: number, value: number): void {
  let arr = _signalHistory.get(signalId);
  if (!arr) { arr = []; _signalHistory.set(signalId, arr); }
  // Replace if same round, otherwise append
  const existing = arr.findIndex(e => e.round === round);
  if (existing >= 0) arr[existing].value = value;
  else arr.push({ round, value });
}

export function getSignalValue(signalId: string, roundsBack: number): number | null {
  const arr = _signalHistory.get(signalId);
  if (!arr || arr.length === 0) return null;
  if (roundsBack <= 0) return arr[arr.length - 1]?.value ?? null;
  const idx = arr.length - 1 - roundsBack;
  return idx >= 0 ? arr[idx].value : null;
}

export function movingAverageSignal(signalId: string, windowSize: number): number | null {
  const arr = _signalHistory.get(signalId);
  if (!arr || arr.length < windowSize) return null;
  const slice = arr.slice(-windowSize);
  return slice.reduce((sum, e) => sum + e.value, 0) / slice.length;
}

export function resetSignalHistory(): void {
  _signalHistory.clear();
}

// ── Gap injection counter ────────────────────────────────────────────
export let _gapInjectionCount = 0;
export function resetGapInjectionCount(): void { _gapInjectionCount = 0; }
export function setGapInjectionCount(n: number): void { _gapInjectionCount = n; }
export function incrementGapInjectionCount(): void { _gapInjectionCount++; }

/** Push a user-visible warning into debateWarnings state (capped at 50). */
export function pushWarning(

  get: () => any,

  set: (partial: any) => void,
  msg: string,
): void {
  const current: string[] = get().debateWarnings ?? [];
  if (current.length < 50) {
    set({ debateWarnings: [...current, msg] });
  }
}

/** Record diagnostic data for a transcript entry (only when diagnostics enabled) */
export function recordDiagnostic(

  get: () => any,

  set: (partial: any) => void,
  entryId: string,
  data: Partial<EntryDiagnostics>,
): void {
  // Always capture diagnostic data — the toggle only controls UI visibility
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const diag: DebateDiagnostics = debate.diagnostics || {
    enabled: true,
    entries: {},
    overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
  };

  diag.entries[entryId] = { ...diag.entries[entryId], ...data };

  // Update overview counters
  if (data.response_time_ms) {
    diag.overview.total_ai_calls++;
    diag.overview.total_response_time_ms += data.response_time_ms;
  }

  // Aggregate per-stage token counts into entry and overview totals
  const stages = data.stage_diagnostics;
  if (stages && stages.length > 0) {
    let entryInput = 0;
    let entryOutput = 0;
    let hasTokens = false;
    for (const s of stages) {
      if (s.input_tokens != null) { entryInput += s.input_tokens; hasTokens = true; }
      if (s.output_tokens != null) { entryOutput += s.output_tokens; hasTokens = true; }
    }
    if (hasTokens) {
      diag.entries[entryId].input_tokens = entryInput;
      diag.entries[entryId].output_tokens = entryOutput;
      diag.overview.total_input_tokens = (diag.overview.total_input_tokens ?? 0) + entryInput;
      diag.overview.total_output_tokens = (diag.overview.total_output_tokens ?? 0) + entryOutput;
    }
  }

  const updatedDebate = { ...debate, diagnostics: diag };
  set({ activeDebate: updatedDebate });

  // Broadcast to popout window
  try { api.sendDiagnosticsState({ debate: updatedDebate, selectedEntry: get().selectedDiagEntry }); } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', debate_id: debate?.id, component: 'debate-store', level: 'warn', message: 'Diagnostics broadcast to popout failed (recordDiagnostic)', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
}
