// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Inquiry result contract (t/3574) — the shared shape of an "Ask a question" answer artifact.
// Decisions recorded in docs/adr/ADR-0002-inquiry-result-contract.md; design in docs/hld-inquiry-ux.md.
//
// Zod is the SOURCE OF TRUTH and every type is inferred from its schema (t/3535 convention) — no
// hand-written interface may sit alongside a schema, or the two silently drift. This artifact crosses
// five consumers (Shared Lib, DebateTool, ServerAPI, ElectronMain, Rosetta) and at least two
// serialization boundaries (job store, REST, IPC), so a bare interface would mean five hand-rolled
// validations or five `as InquiryResult` casts. It is a persisted, shareable artifact — its shape is a
// one-way door, which is why schemaVersion + a single parser (parse.ts) exist from v1.
//
// Schema only. No pipeline logic ships here — the four DebateTool stage tickets build behind this.

import { z } from 'zod';

/**
 * Contract major version. The integer IS the major (no encoded major.minor) — TL t/3574#2.
 * Versioning rule: **add an optional field → no bump** (passthrough carries it on old readers);
 * **change anything a v1 reader would silently misread → bump**. `parseInquiryResult` (parse.ts)
 * owns all version policy.
 */
export const INQUIRY_SCHEMA_VERSION = 1;

/** Fidelity stays a CLOSED enum (ADR §4). A parameterized version re-grows the 40-field CLIConfig one
 *  option at a time — the friction this feature removes. `InquiryResult.derivation` stamps the resolved
 *  facts so the enum is free to evolve without touching persisted results. */
export const FidelitySchema = z.enum(['quick', 'standard', 'deep']);
export type Fidelity = z.infer<typeof FidelitySchema>;

/** POV camp codes (root AGENTS.md): acc / saf / skp / cc. */
export const CampSchema = z.enum(['acc', 'saf', 'skp', 'cc']);
export type Camp = z.infer<typeof CampSchema>;

export const TrustVerdictSchema = z.enum(['trust', 'censored']);
export type TrustVerdict = z.infer<typeof TrustVerdictSchema>;

// ── Model override (t/3574#3, UX sign-off) ──────────────────────────────────
// An optional explicit model choice — on a research platform the model IS a variable worth
// controlling (comparing how two models debate the same question is the experiment), not config noise.
// Fidelity still supplies the default; this only overrides it. Deliberately `z.string()`, NOT a closed
// enum of model ids: models retire, and baking ids into the contract is exactly what the t/3560 lint
// guards against. Membership is validated against ai-models.json AT THE BOUNDARY (ServerAPI), so the
// contract module never loads the registry. Provenance needs no separate audit trail here —
// `ResolvedDerivationSchema` already stamps the models actually used, tier-derived or overridden alike.
export const ModelOverrideSchema = z.object({
  debaters: z.string().optional(),
  evaluator: z.string().optional(),
});
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;

// ── InquiryRequest ────────────────────────────────────────────────────────────
// STRICT at the client-input boundary (TL t/3574#2): a mistyped key — `situationID` for
// `situationId` — must FAIL LOUDLY, not be silently accepted-and-dropped, which would run the inquiry
// ungrounded and answer a subtly different question with no signal (the invisible-degradation class).
export const InquiryRequestSchema = z
  .object({
    question: z.string().min(1),
    /** Maps to rounds, models, pacing, and an explicit budget via deriveDebateConfig (t/3575). */
    fidelity: FidelitySchema,
    /** Optional explicit grounding anchor; when absent the pipeline derives one. */
    situationId: z.string().optional(),
    /** Optional explicit model override (t/3574#3); when absent, fidelity's tier default applies. */
    models: ModelOverrideSchema.optional(),
  })
  .strict();
export type InquiryRequest = z.infer<typeof InquiryRequestSchema>;

/** The COPY embedded in a persisted `InquiryResult` (TL t/3574#2). Passthrough, not strict: a v1 reader
 *  round-tripping a v2 result must not strip a field v2 added to the request. Strictness is a property
 *  of the live input boundary, not of the stored receipt. */
export const StoredInquiryRequestSchema = InquiryRequestSchema.passthrough();
export type StoredInquiryRequest = z.infer<typeof StoredInquiryRequestSchema>;

// ── TrustState ────────────────────────────────────────────────────────────────
// `reason` is MANDATORY (ADR §6): a verdict records WHY it was reached — which gate fired and which
// termination reason drove it — not a bare trust/censored label. The metric→family binding evolves
// with the calibration work; a verdict carrying its reasoning stays interpretable across that change.
export const TrustStateSchema = z.object({
  verdict: TrustVerdictSchema,
  reason: z.string().min(1),
  /** e.g. `api_ceiling`, `max_iterations`, `situation_cap`, or `natural` — what drove the verdict. */
  terminationReason: z.string().optional(),
  /** The metric family the verdict binds to (e.g. `convergence`), when applicable. */
  metricFamily: z.string().optional(),
});
export type TrustState = z.infer<typeof TrustStateSchema>;

// ── Node references ───────────────────────────────────────────────────────────
// Carry the node id (for live navigation) AND an inline display snapshot (ADR §5). The taxonomy is
// mutable; a result opened later degrades to STALE LABELS rather than broken references.
export const NodeRefSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  camp: CampSchema,
});
export type NodeRef = z.infer<typeof NodeRefSchema>;

// ── GroundingEnvelope ─────────────────────────────────────────────────────────
// Anchor situation + per-camp node sets. Embedded in the result (ADR §5/§7) so a stored result reads
// without resolving anything against live data.
export const GroundingEnvelopeSchema = z
  .object({
    anchorSituationId: z.string().optional(),
    anchorSummary: z.string().optional(),
    // PARTIAL over camps: an envelope legitimately carries nodes for only some camps. z.record over an
    // enum key is EXHAUSTIVE in zod v4 (would require all four); partialRecord keeps the camp typing
    // while allowing a subset.
    nodesByCamp: z.partialRecord(CampSchema, z.array(NodeRefSchema)),
  })
  .passthrough();
export type GroundingEnvelope = z.infer<typeof GroundingEnvelopeSchema>;

// ── Evidence layer ──────────────────────────────────────────────────────────
// Modeled, not a bare string (TL t/3574#2 note a): the UI renders title / role / what-it-solves /
// sources separately, so the renderer must not parse prose to recover that structure.
export const EvidenceLayerSchema = z.object({
  title: z.string(),
  /** What this layer does. */
  role: z.string(),
  /** What this layer solves. */
  solves: z.string(),
  sources: z.array(z.string()),
});
export type EvidenceLayer = z.infer<typeof EvidenceLayerSchema>;

// ── Convergence (cross-cutting agreement) ─────────────────────────────────────
// A claim PLUS its node mapping (TL note a): the pilot output maps a convergence to concrete POV nodes
// (e.g. "maps to skp-beliefs-029"). Carried as NodeRefs so the mapping survives with its snapshot.
export const ConvergenceSchema = z.object({
  claim: z.string(),
  nodes: z.array(NodeRefSchema),
});
export type Convergence = z.infer<typeof ConvergenceSchema>;

// ── Unresolved gap ────────────────────────────────────────────────────────────
// Description PLUS a confidence qualifier (TL note a). `confidence` is a free string for v1 to preserve
// the pilot's phrasing; promote to an enum later if the qualifier vocabulary settles (additive → no bump).
export const UnresolvedGapSchema = z.object({
  description: z.string(),
  confidence: z.string(),
});
export type UnresolvedGap = z.infer<typeof UnresolvedGapSchema>;

// ── Resolved derivation (the "receipt", ADR §4) ───────────────────────────────
// Records the resolved facts a run actually used, not just the fidelity label — `'standard'` in June
// won't mean what it meant in March as models retire and budgets are tuned. `callBudget` is PRIMARY
// (TL note b): runs terminate on `api_ceiling`, a CALL ceiling, and that is the meter the UI surfaces;
// USD is carried alongside when available but is never the only number.
export const ResolvedDerivationSchema = z.object({
  fidelity: FidelitySchema,
  /** stage → model id actually used (reads ai-models.json tiers, not literals — t/3564). */
  models: z.record(z.string(), z.string()),
  rounds: z.number().int(),
  /** The binding ceiling — the thing `api_ceiling` truncation refers to. */
  callBudget: z.number().int().nonnegative(),
  /** Calls actually consumed, when captured. */
  callsUsed: z.number().int().nonnegative().optional(),
  /** Resolved/estimated cost in USD, alongside the call budget when available. */
  costUsd: z.number().nonnegative().optional(),
});
export type ResolvedDerivation = z.infer<typeof ResolvedDerivationSchema>;

// ── Calibration entry ─────────────────────────────────────────────────────────
// Each metric carries its OWN trust state (HLD). `displayValue` (TL note c) preserves ratio rendering
// like "72 / 84" (claim acceptance) that a bare `number` cannot express — it decides whether the UI
// formats or parses.
export const CalibrationEntrySchema = z.object({
  metric: z.string(),
  value: z.number(),
  /** Human display form when `value` alone is lossy, e.g. "72 / 84". */
  displayValue: z.string().optional(),
  trust: TrustStateSchema,
});
export type CalibrationEntry = z.infer<typeof CalibrationEntrySchema>;

// ── Camp verdict ──────────────────────────────────────────────────────────────
export const CampVerdictSchema = z.object({
  camp: CampSchema,
  verdict: z.string(),
  nodes: z.array(NodeRefSchema),
});
export type CampVerdict = z.infer<typeof CampVerdictSchema>;

// ── InquiryResult ─────────────────────────────────────────────────────────────
// The rendered answer's data model and a persisted, shareable artifact. `.passthrough()` = tolerant
// reader (ADR §3): a strict object would strip a newer build's unknown field on round-trip and silently
// destroy it. Version routing is the parser's job (parse.ts), not the schema's.
export const InquiryResultSchema = z
  .object({
    schemaVersion: z.number().int(),
    request: StoredInquiryRequestSchema,
    campVerdicts: z.array(CampVerdictSchema),
    convergences: z.array(ConvergenceSchema),
    evidenceLayers: z.array(EvidenceLayerSchema),
    unresolvedGaps: z.array(UnresolvedGapSchema),
    calibration: z.array(CalibrationEntrySchema),
    derivation: ResolvedDerivationSchema,
    grounding: GroundingEnvelopeSchema,
    /** The single-run caveat (n ≥ 10 replication gate). Generated into every result, never hand-written,
     *  so the UX cannot systematically overclaim from one run (HLD). */
    singleRunCaveat: z.string(),
  })
  .passthrough();
export type InquiryResult = z.infer<typeof InquiryResultSchema>;
