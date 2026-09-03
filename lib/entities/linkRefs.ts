// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonical Zod schemas for the forward-grounding link refs (t/3157) — the SINGLE source of truth
// for validating an `EntityLinkRef` / `ConceptLinkRef` (see ./types.ts). Previously taxonomy-editor's
// `validation.ts` hand-copied these as inline Zod, a drift risk (t/3253, the same class t/3250 fixed
// for `logical_form`). Consumers (povNodeSchema in validation.ts) import from here instead of
// re-declaring, so the runtime validator can never drift from the persisted shape.
//
// Objects are `.passthrough()` (matches the prior hand-mirror + the entity/logical_form convention):
// every DEFINED field is strictly validated (required-present, enums in-vocab) while additive unknown
// keys are forgiven for forward-compat. Vocabulary anti-drift lives in the bidirectional `Equals`
// guards at the bottom (a value list that diverges from its `types.ts` type fails `tsc`).
import { z } from 'zod';
import type { EntityLinkRef, ConceptLinkRef, EntityMatchLevel, EntityLinkStatus } from './types.js';

// Closed vocabularies kept LOCAL so the Zod enums are first-class, then pinned to the `types.ts`
// types by the guards below (drift in EITHER direction fails tsc — TL t/3250#2(1)).
const ENTITY_METHODS = ['exact', 'alias', 'embedding'] as const;      // how an ent-* ref was found
const CONCEPT_METHODS = ['surface', 'embedding'] as const;            // concepts have no alias table
const MATCH_LEVELS = ['exact', 'instance_of', 'subclass', 'superclass', 'related'] as const;
const LINK_STATUSES = ['linked', 'proposed'] as const;

export const entityMethodSchema = z.enum(ENTITY_METHODS);
export const conceptMethodSchema = z.enum(CONCEPT_METHODS);
export const linkMatchLevelSchema = z.enum(MATCH_LEVELS);
export const linkStatusSchema = z.enum(LINK_STATUSES);

/** Zod mirror of {@link EntityLinkRef} — a resolved link from a container's `entity_refs[]` to a
 *  register entity. `match_level` is load-bearing for the prover; `status` gates whether it counts. */
export const entityLinkRefSchema = z.object({
  ref: z.string(),
  surface: z.string(),
  method: entityMethodSchema,
  link_confidence: z.number(),
  match_level: linkMatchLevelSchema,
  status: linkStatusSchema,
}).passthrough();

/** Zod mirror of {@link ConceptLinkRef} — a resolved link to a dictionary concept (`term:*`).
 *  No `match_level` (a concept already names a kind, so there is no subsumption hop). */
export const conceptLinkRefSchema = z.object({
  ref: z.string(),
  surface: z.string(),
  method: conceptMethodSchema,
  link_confidence: z.number(),
  status: linkStatusSchema,
}).passthrough();

// ── Bidirectional anti-drift guards (TL t/3250#2(1)) ─────────────────────────────────────────
// Exact type-equality: fails `tsc` if a closed vocabulary diverges from its `types.ts` type in
// EITHER direction. Compile-time only (erased at runtime). If a line errors, reconcile this file
// with types.ts (the interface is the source of truth for the shape).
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export type _AssertEntityMethod = Assert<Equals<z.infer<typeof entityMethodSchema>, EntityLinkRef['method']>>;
export type _AssertConceptMethod = Assert<Equals<z.infer<typeof conceptMethodSchema>, ConceptLinkRef['method']>>;
export type _AssertMatchLevel = Assert<Equals<z.infer<typeof linkMatchLevelSchema>, EntityMatchLevel>>;
export type _AssertLinkStatus = Assert<Equals<z.infer<typeof linkStatusSchema>, EntityLinkStatus>>;
