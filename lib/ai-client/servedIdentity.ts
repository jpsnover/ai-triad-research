// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Served-identity classifier (t/3731 Phase 3). Compares the model id we SENT a provider with the id the
 * provider REPORTS it served, and classifies the pair as agree / divergent / unknown.
 *
 * WARN-ONLY. A `divergent` result raises the `ai.model_identity` event to `warn`; it never blocks a run.
 * Making divergence block is a gate promotion (warn cycle, GV, its own Second Opinion), TL t/3731#7 cond 4.
 *
 * Design: t/3731#11 (TL e/257#10, SO e/257#12). In order:
 *   1. served unreported            -> unknown/unreported (info, never warn: Phase-1 rule)
 *   2. no registry passed           -> unknown/no-registry
 *   3. sent is a synthesized `*-latest` alias -> resolve via buildModelEntryMap first (TL e/257#6)
 *   4. served === sent              -> agree/exact
 *   5. date relation, any backend   -> served = sent + date, or sent `-latest` replaced by a date: agree/snapshot;
 *                                      sent pinned, served the undated alias: unknown/pin-unverified;
 *                                      same base, different dates: divergent/snapshot-mismatch
 *   6. served is another registry entry on this backend, keyed (backend, apiModelId) -> divergent/registry-distinct
 *   7. served is no registry entry  -> observed adapter + its documented suffix: agree/provider-suffix;
 *                                      otherwise unknown (unregistered-served | uncalibrated-adapter)
 *
 * Surviving vector (t/3731#11): a provider alias whose resolution changes its BASE name would read
 * divergent falsely. Today's registry has none. Warn-only + dedup keeps it visible noise, not silence.
 */

import type { ModelRegistry } from './registry.js';
import { buildModelEntryMap } from './registry.js';
import type { FlightRecorder } from '../flight-recorder/flightRecorder.js';

/**
 * Calibration, co-located with the rule it gates (TL t/3731#7 cond 2). As of 2026-10-06, about 3,000
 * `ai.model_identity` events: every observed pair agreed exactly (t/3731#4-#6). Provider suffix tolerance
 * (step 7) applies ONLY to observed adapters. Don't guess tolerances for the unobserved ones: a mismatch
 * there is `unknown/uncalibrated-adapter`, which fails safe (info, never warn).
 */
export const OBSERVED_IDENTITY_ADAPTERS: readonly string[] = ['gemini', 'claude', 'zai', 'moonshot'];
export const UNOBSERVED_IDENTITY_ADAPTERS: readonly string[] = ['openai', 'groq', 'xai', 'azure', 'deepseek', 'ollama'];

export type ServedIdentityState = 'agree' | 'divergent' | 'unknown';
export type ServedIdentityReason =
  | 'exact' | 'snapshot' | 'alias-resolved' | 'provider-suffix'
  | 'registry-distinct' | 'snapshot-mismatch'
  | 'unreported' | 'no-registry' | 'pin-unverified' | 'unregistered-served' | 'uncalibrated-adapter';

export interface ServedIdentityVerdict {
  state: ServedIdentityState;
  reason: ServedIdentityReason;
  /** The id compared against `served` after synthesized-alias resolution (step 3), when it differs from `sent`. */
  resolvedSent?: string;
}

export interface ServedIdentityInput {
  registry: ModelRegistry | undefined;
  backend: string;
  sent: string;
  served: string | undefined;
}

const verdict = (state: ServedIdentityState, reason: ServedIdentityReason, resolvedSent?: string): ServedIdentityVerdict =>
  (resolvedSent ? { state, reason, resolvedSent } : { state, reason });

function validMonthDay(mm: string, dd: string): boolean {
  const m = Number(mm), d = Number(dd);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function validDate(yyyy: string, mm: string, dd: string): boolean {
  if (!validMonthDay(mm, dd)) return false;
  const dt = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return dt.getUTCMonth() === Number(mm) - 1 && dt.getUTCDate() === Number(dd);
}

/** Splits a trailing snapshot date off an id. Legacy `-MMDD` counts only on openai (TL e/257#10):
 *  four digits are a weaker signal than a full date, and only OpenAI is known to use them. */
export function splitDateSuffix(id: string, backend: string): { base: string; date: string } | null {
  let m = id.match(/^(.+)-(\d{4})-(\d{2})-(\d{2})$/);
  if (m && validDate(m[2], m[3], m[4])) return { base: m[1], date: `${m[2]}${m[3]}${m[4]}` };
  m = id.match(/^(.+)-(\d{4})(\d{2})(\d{2})$/);
  if (m && validDate(m[2], m[3], m[4])) return { base: m[1], date: `${m[2]}${m[3]}${m[4]}` };
  if (backend === 'openai') {
    m = id.match(/^(.+)-(\d{2})(\d{2})$/);
    if (m && validMonthDay(m[2], m[3])) return { base: m[1], date: `${m[2]}${m[3]}` };
  }
  return null;
}

function dateRelation(sent: string, served: string, backend: string): ServedIdentityVerdict | null {
  const s = splitDateSuffix(sent, backend);
  const v = splitDateSuffix(served, backend);
  if (!s && v && (v.base === sent || `${v.base}-latest` === sent)) return verdict('agree', 'snapshot');
  if (s && !v && (s.base === served || `${s.base}-latest` === served)) return verdict('unknown', 'pin-unverified');
  if (s && v && s.base === v.base) return verdict('divergent', 'snapshot-mismatch');
  return null;
}

/** Observed-adapter suffix tolerance. Gemini documents `-NNN` builds and `-preview[-MM-YYYY]` labels
 *  (t/3731#3); Claude's `-YYYYMMDD` is already a date (step 5); zai and moonshot showed exact ids only. */
function providerSuffix(backend: string, sent: string, served: string): boolean {
  if (backend !== 'gemini' || !served.startsWith(`${sent.replace(/-preview$/, '')}-`)) return false;
  const rest = served.slice(sent.replace(/-preview$/, '').length);
  return /^-\d{3}$/.test(rest) || /^-preview(?:-\d{2}-\d{4})?$/.test(rest);
}

function resolveSynthesizedAlias(registry: ModelRegistry, backend: string, sent: string): string | undefined {
  if (!sent.endsWith('-latest')) return undefined;
  if (registry.models.some((m) => m.backend === backend && m.apiModelId === sent)) return undefined; // a literal provider alias
  const entry = buildModelEntryMap(registry)[sent];
  return entry && entry.backend === backend ? entry.apiModelId : undefined;
}

export function classifyServedIdentity({ registry, backend, sent, served }: ServedIdentityInput): ServedIdentityVerdict {
  if (!served) return verdict('unknown', 'unreported');
  if (!registry) return verdict('unknown', 'no-registry');
  const resolved = resolveSynthesizedAlias(registry, backend, sent);
  if (resolved && served === resolved) return verdict('agree', 'alias-resolved', resolved);
  const effective = resolved ?? sent;
  if (served === effective) return verdict('agree', 'exact');
  const dated = dateRelation(effective, served, backend);
  if (dated) return { ...dated, ...(resolved ? { resolvedSent: resolved } : {}) };
  if (registry.models.some((m) => m.backend === backend && m.apiModelId === served)) {
    return verdict('divergent', 'registry-distinct', resolved);
  }
  if (!OBSERVED_IDENTITY_ADAPTERS.includes(backend)) return verdict('unknown', 'uncalibrated-adapter', resolved);
  if (providerSuffix(backend, effective, served)) return verdict('agree', 'provider-suffix', resolved);
  return verdict('unknown', 'unregistered-served', resolved);
}

// ── Per-process bookkeeping (SO e/257#2 conditions 2 and 3) ────────────────────────────────────────

const counts = new Map<string, number>();
const divergentSeen = new Map<string, number>();
const backendsSeen = new Set<string>();

export interface ServedIdentityObservation {
  /** True on the first call this process makes to the backend (TL t/3731#7: surfaces a new adapter for calibration). */
  firstSeen: boolean;
  /** Occurrences of this exact (backend, sent, served) divergence so far, this one included; 0 when not divergent. */
  divergentCount: number;
  /** True only on the first occurrence of a divergent triple: the event is raised to warn once, then stays info. */
  warn: boolean;
}

/** Records one verdict in the process-wide counters and returns what the caller should log. */
export function observeServedIdentity(backend: string, sent: string, served: string | undefined, v: ServedIdentityVerdict): ServedIdentityObservation {
  const firstSeen = !backendsSeen.has(backend);
  backendsSeen.add(backend);
  const key = `${v.state}/${v.reason}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (v.state !== 'divergent') return { firstSeen, divergentCount: 0, warn: false };
  const triple = `${backend}\u0000${sent}\u0000${served ?? ''}`;
  const divergentCount = (divergentSeen.get(triple) ?? 0) + 1;
  divergentSeen.set(triple, divergentCount);
  return { firstSeen, divergentCount, warn: divergentCount === 1 };
}

/** Counts per `state/reason` this process (SO condition 2: every `unknown` is counted by its reason). */
export function getServedIdentitySummary(): Record<string, number> {
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

const recordersWithSummary = new WeakSet<FlightRecorder>();

/** Puts the per-reason summary into every dump `recorder` writes, under `served_identity` (t/4023: so a
 *  dump shows whether a quiet log meant "all agreed" or "all unknown/no-registry"). Once per recorder. */
export function attachServedIdentitySummary(recorder: FlightRecorder | null | undefined): void {
  if (!recorder || recordersWithSummary.has(recorder)) return;
  recordersWithSummary.add(recorder);
  // Diagnostics must never break an AI call. A recorder stand-in without the method (a partial stub) is
  // skipped, and the skip is logged once so a dump missing `served_identity` is explainable.
  if (typeof recorder.addContextContributor !== 'function') {
    recorder.record?.({
      type: 'ai.model_identity', component: 'ai-client', level: 'warn',
      message: 'served-identity summary not attached: this recorder has no addContextContributor, so its dumps omit served_identity',
    });
    return;
  }
  recorder.addContextContributor('served_identity', getServedIdentitySummary);
}

export function _resetServedIdentityStateForTests(): void {
  counts.clear();
  divergentSeen.clear();
  backendsSeen.clear();
}
