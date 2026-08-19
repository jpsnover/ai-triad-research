// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared TypeScript types for the Debate Brief Export pipeline (t/2799).
// These are the canonical types consumed by server, renderer, and PowerShell.
// JSON schema source of truth: lib/brief/schemas/*.write.json

// ── Primitives ────────────────────────────────────────────────────────────────

/** deck_spec_version string — major-line 1.x; writers emit the exact version they produce. */
export type DeckSpecVersion = string;

export type BriefPreset     = 'policymaker' | 'conference' | 'classroom';
export type ModelSource     = 'Explicit' | 'Global' | 'Default';
export type DisagreementKind = 'EMPIRICAL' | 'VALUES';
export type FactCheckVerdict = 'Supported' | 'Disputed' | 'Unverifiable';
export type DebatePhase      = 'concluding' | 'closed' | 'open';
export type NarrationMode    = 'narrated' | 'deterministic';

// ── deck_spec.json ────────────────────────────────────────────────────────────

export interface DeckSpec {
  deck_spec_version: DeckSpecVersion;
  meta: DeckSpecMeta;
  question: DeckSpecQuestion;
  framing_critique: FramingCritique;
  agreements: TextNode[];
  disagreements: Disagreement[];
  cruxes: Crux[];
  resolution_analysis: ResolutionAnalysis;
  unresolved_questions: TextNode[];
  argument_map: ArgumentMap;
  fact_checks: FactCheck[];
  concessions: CampConcessions[];
  top_claims: TopClaim[];
  convergence: ConvergenceScore[];
  open_threads: TextNode[];
}

export interface DeckSpecMeta {
  id: string;
  run_id: string;
  title: string;
  model: string;
  protocol: string;
  phase: DebatePhase;
  transition_rationale?: string;
  /** True when exported via allowOpen=true — drives render watermark. */
  snapshot?: boolean;
  snapshot_note?: string;
}

export interface DeckSpecQuestion {
  core_proposition: string;
  tensions?: string[];
  qualifiers?: string[];
  exclusions?: string[];
  time_horizon?: string;
}

export interface FramingCritique {
  rating: string;
  composite: number;
  rewritten_motion?: string;
}

export interface TextNode {
  text: string;
  source_ref?: string;
}

export interface Disagreement extends TextNode {
  kind: DisagreementKind;
  resolution_path: string;
}

export interface Crux {
  text: string;
  kind: DisagreementKind;
  if_yes: string;
  if_no: string;
}

export interface ResolutionAnalysis {
  stronger_camp_findings: { camp: string; finding: string }[];
  would_change_if?: { camp: string; falsifier: string }[];
}

export interface ArgumentMap {
  nodes: { id: string; camp: string; label: string; strength?: number }[];
  relations: { from: string; to: string; type: string }[];
}

export interface FactCheck {
  claim: string;
  verdict: FactCheckVerdict;
  sources?: string[];
  explanation?: string;
  /** 'system' = neutral evidence injected by fact-checker, not a camp claim. */
  speaker?: string;
}

export interface CampConcessions {
  camp: string;
  asserted: number;
  conceded: number;
  challenged: number;
}

export interface TopClaim {
  camp: string;
  claim: string;
  strength: number;
}

export interface ConvergenceScore {
  issue: string;
  score: number;
}

// ── narration.json ────────────────────────────────────────────────────────────

export interface Narration {
  deck_spec_version: DeckSpecVersion;
  narration_mode: NarrationMode;
  /** Preset this narration was produced for — required for re-render and audit. */
  preset: BriefPreset;
  narrator_model: string;
  narrator_model_source: ModelSource;
  checker_model?: string | null;
  checker_model_source?: ModelSource | null;
  checker_passed?: boolean | null;
  entries: NarrationEntry[];
  audience_questions: AudienceQuestion[];
}

export interface NarrationEntry {
  /** RFC 6901 JSON Pointer into deck_spec. E.g. /cruxes/1 */
  trace: string;
  text: string;
  slide?: number;
}

export interface AudienceQuestion {
  /** RFC 6901 JSON Pointer into deck_spec. */
  trace: string;
  question: string;
}

// ── audit-manifest.json ───────────────────────────────────────────────────────

export interface AuditManifest {
  debate_id: string;
  run_id: string;
  deck_spec_version: DeckSpecVersion;
  timestamp: string;
  tool_versions: Record<string, string>;
  artifacts: { name: string; sha256: string }[];
  narrator_model: string;
  narrator_model_source: ModelSource;
  checker_model?: string | null;
  checker_model_source?: ModelSource | null;
  narration_mode: NarrationMode;
  /**
   * % of narration entries with a resolvable trace (0–100).
   * For mode=narrated, enforcement of ==100 is the T5 verify gate, not this type.
   */
  trace_coverage_pct: number;
  symmetry: SymmetryAudit;
  verdict_counts: Partial<Record<FactCheckVerdict, number>>;
  warnings: string[];
}

export interface SymmetryAudit {
  camps: { camp: string; slide_count: number; headline_count: number; word_budget: number }[];
  within_tolerance: boolean;
  tolerance_pct: number;
}

// ── TriadDeckExport — PS -PassThru output shape (spec §8) ────────────────────

export interface TriadDeckExport {
  debateId: string;
  title: string;
  preset: BriefPreset;
  model: string;
  modelSource: ModelSource;
  checkerModel?: string;
  path: string;
  specPath?: string;
  manifestPath: string;
  traceCoveragePct: number;
  verdicts: Partial<Record<FactCheckVerdict, number>>;
  warnings: string[];
}
