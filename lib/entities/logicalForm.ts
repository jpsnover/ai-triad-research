// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonical `logical_form` Zod schema — ONE definition for both claim and node frames
// (t/3250, from TL G6 t/3162#5). Node-formalization (`formalize_node_lf.py`, Python) and
// claim-formalization (`Invoke-LogicalFormPass`, PS) are two ports of the same neo-Davidsonian
// pass; this is the TS embodiment of the shape doc so the four conformance points —
//   1. the schema DOC  `research/comp-linguist/docs/logical-form-schema.md` (source of record)
//   2. the PS pass      `scripts/AITriad/Private/LogicalFormPass.ps1`
//   3. the Python pass  `research/comp-linguist/tools/formalize_node_lf.py`
//   4. THIS file        (the TS validator, consumed by taxonomy-editor node validation)
// — cannot silently drift. A formalization change must update all four (see the prompt-port
// coupling note in the schema doc, CL-owned).
//
// Consumed now by `taxonomy-editor` `povNodeSchema` (node frames); a future TS claim-frame
// validator consumes the SAME definition (TL t/3250#2(3): node-now / claim-when-TS-validates).
//
// Field shape mirrors the doc's §Schema exactly. Objects are `.passthrough()` (TL t/3250#2(2)):
// every DEFINED field is still strictly validated (required-present + enums in-vocab) — that is
// the win over today's total silence — while additive unknown keys are forgiven for forward-compat
// (matches the `entityLinkRefSchema` convention). Vocabulary anti-drift lives in the bidirectional
// type-equality guards below + the coupling doc, NOT in inner-strictness.
import { z } from 'zod';
import type { DolceCategory, EntityMatchLevel } from './types.js';

/** Thematic role of an event participant (neo-Davidsonian participation predicate). Closed set;
 *  extend only with CL sign-off + a register note (schema doc §args[].role). */
export const lfRoleSchema = z.enum([
  'agent', 'patient', 'theme', 'recipient', 'instrument',
  'location', 'source', 'goal', 'beneficiary', 'cause', 'manner',
]);

// An arg-slot `sort` lies on the DOLCE particular/universal axis (§12.1 / claims-entity-fol-
// recommendations line 240: an arg slot is "an endurant, a perdurant, or a universal"). The two
// spaces are kept SEPARATE by construction so the category error — typing a universal with a
// particular's sort — is unrepresentable (TL t/3251#2(3) + sign-off p/342#266). `lfSortSchema`
// (the arg-slot validator) is their UNION.

// PARTICULAR sorts — the 5 DOLCE-lite leaves that type particulars (`ent-*` refs). Kept LOCAL so
// the Zod enum is first-class, then pinned EXACT to `types.ts` DolceCategory by the bidirectional
// `Equals` guard at the bottom — `tsc` fails on drift in EITHER direction (TL t/3250#2(1)).
const DOLCE_CATEGORIES = [
  'agentive-physical-object', 'non-agentive-functional-artifact',
  'perdurant', 'normative-description', 'non-agentive-social-object',
] as const;
/** A PARTICULAR's DOLCE-lite sort — copied verbatim from the entity register (`dolce_category`),
 *  never re-judged per claim (schema doc rule 2). Pinned exact to `DolceCategory`. */
export const particularSortSchema = z.enum(DOLCE_CATEGORIES);

// UNIVERSAL sorts — its OWN guarded space (t/3251). A `concept_ref` (`term:*`) is a universal/kind,
// the peer top-level arg-slot type disjoint from all 5 particular sorts (§12.1). v1 is a single
// `universal`; the list is MONOTONE-EXTENSIBLE — v2 sub-types (`universal:kind`, `universal-of(<dolce>)`)
// append here with no breaking change and no re-formalization (TL t/3251#2(2)).
const UNIVERSAL_SORTS = ['universal'] as const;
/** A UNIVERSAL's sort. `universal` is disjoint from the 5 particular sorts; a particular arg bridges
 *  to a universal via `match_level: instance_of` (GPT-4 instance_of large-language-model), which is
 *  the §240 kind-vs-particular distinction the t/3127 sort-checker needs. */
export const universalSortSchema = z.enum(UNIVERSAL_SORTS);

// The arg-slot sort accept-set = particular ∪ universal (5 + 1 = 6). `as const` keeps it a readonly
// tuple of literals so `z.enum` infers the exact union. The particular space stays pinned to
// DolceCategory (guard below); `universal` never leaks into that enum.
const ARG_SORTS = [...DOLCE_CATEGORIES, ...UNIVERSAL_SORTS] as const;
/** The sort of an event participant — a particular DOLCE sort (`ent-*`) OR `universal` (`term:*`). */
export const lfSortSchema = z.enum(ARG_SORTS);

const MATCH_LEVELS = ['exact', 'instance_of', 'subclass', 'superclass', 'related'] as const;
/** How the ref matched its target relative to the register — copied verbatim from the
 *  entity_ref; load-bearing for the prover (schema doc §args[].match_level). */
export const lfMatchLevelSchema = z.enum(MATCH_LEVELS);

/** One event participant. `ref` is an `ent-*` particular (`entity_refs[]`) → a particular `sort`,
 *  a `term:*` universal (`concept_refs[]`) → `sort: 'universal'`, or a `lit:"…"` / event var for an
 *  unresolved participant (schema doc rule 1). `sort` is the particular∪universal union. */
export const lfArgSchema = z.object({
  role: lfRoleSchema,
  ref: z.string(),
  sort: lfSortSchema,
  match_level: lfMatchLevelSchema,
}).passthrough();

/** Topical grounding entry — an `ent-*` id the claim is *about* (schema doc §about[]).
 *  Superset convention: a topical participant appears in BOTH `args[]` and `about[]`. */
export const lfAboutSchema = z.object({
  ref: z.string(),
  match_level: lfMatchLevelSchema,
}).passthrough();

/** BDI attribution — present for POV/BDI claims, `null` for `factual_claims` (unattributed
 *  fact). The whole object is nullable, not its fields (schema doc §modality). */
export const lfModalitySchema = z.object({
  holder: z.enum(['camp:acc', 'camp:saf', 'camp:skp']),
  attitude: z.enum(['belief', 'desire', 'intention']),
}).passthrough();

/** Event time. `value` is null ⟺ `type: 'unspecified'` (an explicit "no time" reading is
 *  first-class, never a silent omission — schema doc rule 4). */
export const lfTemporalSchema = z.object({
  type: z.enum(['at', 'before', 'after', 'during', 'unspecified']),
  value: z.string().nullable(),
}).passthrough();

/**
 * A neo-Davidsonian event frame on a claim or BDI node. The canonical shape — see
 * `research/comp-linguist/docs/logical-form-schema.md` for full field semantics and the
 * reification rules the FOL track (t/3127/t/3128) consumes.
 *
 * NOTE: `status` here is the FORMALIZATION lifecycle (`proposed|accepted|rejected`) and is
 * DELIBERATELY DISTINCT from `EntityLinkStatus` (`linked|proposed`) in `./types.ts` — do not
 * conflate the two (TL t/3250#2(3)).
 */
export const logicalFormSchema = z.object({
  /** Lemma of the reified event/relation the proposition asserts (lowercase verb/relation lemma). */
  predicate: z.string(),
  /** The Davidsonian event variable (`e1`, `e2`, …), unique within the frame. */
  event_ref: z.string(),
  /** Event participants (may be empty). */
  args: z.array(lfArgSchema),
  /** Negation of the core predication (`¬predicate(e)`), NOT attitude negation. */
  polarity: z.enum(['positive', 'negative']),
  /** BDI attribution; `null` for unattributed `factual_claims`. Present (nullable), never absent. */
  modality: lfModalitySchema.nullable(),
  /** Event time; `unspecified`/`null` is a valid reading, not an omission. */
  temporal: lfTemporalSchema,
  /** Topical index (additive, optional) — the complete set of `ent-*` ids the claim is about. */
  about: z.array(lfAboutSchema).optional(),
  /** [0,1] — the pass's self-rated fidelity of the frame to the proposition; the downstream gate lever. */
  formalization_confidence: z.number().min(0).max(1),
  /** Formalization lifecycle (see NOTE above — distinct from EntityLinkStatus). */
  status: z.enum(['proposed', 'accepted', 'rejected']),
}).passthrough();

/** The canonical logical_form type — inferred from the schema so the runtime validator and the
 *  static type can never diverge. */
export type LogicalForm = z.infer<typeof logicalFormSchema>;

// ── Bidirectional anti-drift guards (TL t/3250#2(1)) ─────────────────────────────────────────
// Exact type-equality: fails `tsc` if the Zod enum and the `types.ts` type diverge in EITHER
// direction (a one-way `satisfies` would miss `types.ts` gaining a member the enum lacks). These
// are compile-time only — erased at runtime.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// If either line errors, a closed vocabulary drifted from its `lib/entities/types.ts` type —
// reconcile this file with types.ts (and the schema doc) before shipping.
//
// The guard pins the PARTICULAR space exactly to `DolceCategory` (NOT the `lfSortSchema` union — that
// now also admits `universal`, which is deliberately NOT a `DolceCategory` member: an entity is never a
// universal, so `Entity.dolce_category` stays the 5 particular sorts). `universal` living outside this
// guard is the point — it keeps the particular/universal spaces separate by construction (t/3251).
export type _AssertParticularSortMatchesDolceCategory =
  Assert<Equals<z.infer<typeof particularSortSchema>, DolceCategory>>;
export type _AssertMatchLevelMatchesEntityMatchLevel =
  Assert<Equals<z.infer<typeof lfMatchLevelSchema>, EntityMatchLevel>>;
