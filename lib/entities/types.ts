// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonical cross-stack entity reference (t/1767 §5 contract). Single home for the
// ref-kind discriminated union — consumed by the server (getEntity) and the renderer
// (resolveRef / DetailPane, t/1775, which IMPORTS this and never forks it). Shipped
// interface-first so the five consumers build in parallel.

// Result payloads reuse the type that already owns each kind's data (never restated —
// that would fork the contract). PovNode/SituationNode live in lib/debate; imported
// type-only (erased at runtime, no runtime coupling). A neutral lib/taxonomy home for
// those record types is a future TL architecture call (t/1767#27).
import type { PovNode, SituationNode } from '../debate/taxonomyTypes.js';
import type { Organization } from '../organizations/types.js';
import type { ColloquialTerm } from '../dictionary/types.js';
import type { PolicyAction } from '../policy/types.js';

/** The kinds of linkable target an EntityRef can point at. */
export type EntityRefKind = 'node' | 'situation' | 'policy' | 'entity' | 'organization' | 'term';

/**
 * A typed reference to any linkable target — POV nodes / situations / policies /
 * entities / vocabulary terms. Discriminated on `kind` for exhaustive kind-dispatch
 * (`switch (ref.kind)`); each variant carries the raw `id`/token. New kinds extend
 * the union without touching existing variants.
 */
export type EntityRef =
  | { kind: 'node'; id: string }        // {pov}-{category}-NNN, e.g. acc-desires-001
  | { kind: 'situation'; id: string }   // sit-NNN (legacy cc-NNN)
  | { kind: 'policy'; id: string }      // pol-*
  | { kind: 'entity'; id: string }        // ent-* — new §3 entity record (entities.json)
  | { kind: 'organization'; id: string }  // org-* — existing Organization record (organizations.json)
  | { kind: 'term'; id: string };         // vocabulary; wire form `term:<slug>`

/** POV / BDI-category node id: {acc|saf|skp}-{beliefs|desires|intentions}-NNN. */
const NODE_ID_RE = /^(?:acc|saf|skp)-(?:beliefs|desires|intentions)-\d+$/;

/**
 * Map a raw id/token to a typed {@link EntityRef} by its prefix/shape. Returns `null`
 * for any unrecognized or ambiguous token — the reference is left unlinked, never
 * guessed (refusal discipline, t/1767 §2). Prefixes are mutually exclusive, so match
 * order is not significant; the node pattern is checked last as the only regex form.
 */
export function parseEntityRef(raw: string): EntityRef | null {
  if (!raw) return null;
  if (raw.startsWith('term:')) return { kind: 'term', id: raw };
  if (raw.startsWith('sit-') || raw.startsWith('cc-')) return { kind: 'situation', id: raw };
  if (raw.startsWith('pol-')) return { kind: 'policy', id: raw };
  if (raw.startsWith('org-')) return { kind: 'organization', id: raw };
  if (raw.startsWith('ent-')) return { kind: 'entity', id: raw };
  if (NODE_ID_RE.test(raw)) return { kind: 'node', id: raw };
  return null;
}

/** Type guard for a valid {@link EntityRefKind} string. */
export function isEntityRefKind(x: string): x is EntityRefKind {
  return x === 'node' || x === 'situation' || x === 'policy' ||
    x === 'entity' || x === 'organization' || x === 'term';
}

// ── Entity record (§3) + getEntity result union (§5, t/1767) ─────────────────────

export type EntityType = 'person' | 'artifact' | 'event' | 'legislation' | 'institution';
export type DolceCategory =
  | 'agentive-physical-object' | 'non-agentive-functional-artifact'
  | 'perdurant' | 'normative-description' | 'non-agentive-social-object';

/**
 * Provenance of an Entity's `description` (t/3131). Drives the person-approval gate in
 * Import-Entity: a `person` is approvable only when this is `human-edited`/`human-authored`
 * (or ABSENT with a non-empty description — grandfathered as human-authored, since the LLM
 * never drafted person descriptions before t/3131). `ai-drafted` is proposable but NOT
 * approvable until a human edits it. Any AI-drafting path for a person description MUST stamp
 * `ai-drafted` at draft time — the grandfather rule (absent ⟺ legacy human-authored) rests
 * entirely on no un-stamped AI draft ever existing (TL t/3131#2 safety condition).
 */
export type EntityDescriptionProvenance = 'ai-drafted' | 'human-edited' | 'human-authored';

/**
 * How a link (an `entity_refs[]` entry on a claim or BDI node) matched its target relative to the
 * register (R4.2) — lets downstream consumers (conflict detection, FOL export) tell an exact match
 * from a subsumption hop. `exact` = the surface names the target; the others = matched via ≤1–2
 * relation hops. Shared match-level VOCABULARY only; the link-record shape and the direction
 * semantics of each label are ASSIGNED by the resolution pass (t/3124) — see there for what each
 * label means at assignment time. Split out of t/3119 to land early (pure enum, no relations/
 * allowlist coupling — CL p/3#156), unblocking the t/3157 node link-refs + t/3124.
 */
export type EntityMatchLevel = 'exact' | 'instance_of' | 'subclass' | 'superclass' | 'related';

/**
 * Confirmation state of a link (t/3157, CL p/3#153). LOAD-BEARING — it's what lets a precise link
 * coexist with a speculative one without contaminating it: `linked` = confirmed (a surface/exact/
 * alias match, or a human/threshold-confirmed embedding hit); `proposed` = an unconfirmed embedding
 * candidate that must NOT count until confirmed (the "Andreessen cos-matches 45 nodes it doesn't
 * mention" problem). Required on every link ref — an unstatused ref is indistinguishable from a
 * confirmed one, which is the failure this field exists to prevent.
 */
export type EntityLinkStatus = 'linked' | 'proposed';

/**
 * A resolved link from a container (a BDI node's `entity_refs[]` — t/3157 — or a claim's
 * `entity_refs[]` — t/3124) to a register entity. ONE shape serves both containers (CL p/3#154).
 * `ref` is the raw `ent-*` token (parsed on read via {@link parseEntityRef}); `method` records how
 * it was found; `match_level` how it matched relative to the register ({@link EntityMatchLevel});
 * `link_confidence` the method-dependent score (exact/alias = 1.0; embedding = cosine); `status`
 * gates whether it counts. Assignment semantics (which label/method/status) are owned by the
 * resolution pass (t/3124) — this is the persisted shape only.
 */
export interface EntityLinkRef {
  ref: string;                                   // ent-* raw token
  surface: string;                               // matched surface form
  method: 'exact' | 'alias' | 'embedding';
  link_confidence: number;                       // [0,1] — method-dependent: 1.0 for exact/alias, cosine for embedding
  match_level: EntityMatchLevel;
  status: EntityLinkStatus;
}

/**
 * A resolved link from a BDI node's `concept_refs[]` to a dictionary concept (`term:*`) — t/3157.
 * Parallel to {@link EntityLinkRef} but simpler: NO `match_level`, because a concept ref already
 * names a kind/class, so there is no subsumption hop to record (CL p/3#154). `method` is narrower
 * (a concept is matched by surface or embedding, never an alias table).
 */
export interface ConceptLinkRef {
  ref: string;                                   // term:<slug> raw token
  surface: string;
  method: 'surface' | 'embedding';
  link_confidence: number;                       // [0,1] — method-dependent: 1.0 for exact/alias, cosine for embedding
  status: EntityLinkStatus;
}

/** The new entity record (ent-*), stored in entities.json. */
export interface Entity {
  id: string;                     // ent-NNN
  name: string;
  aliases: string[];
  entity_type: EntityType;
  dolce_category: DolceCategory;
  /** Genus-differentia: "A [type] that [differentia]...". For a `person`, AI may draft it but
   *  approval requires a human edit — see `description_provenance` and the Import-Entity gate (t/3131). */
  description: string;
  /** Provenance of `description` — gates person approval (t/3131). Absent = legacy/unset
   *  (grandfathered as human-authored when the description is non-empty). See {@link EntityDescriptionProvenance}. */
  description_provenance?: EntityDescriptionProvenance;
  external_refs?: { label: string; url: string }[];
  source_refs?: string[];         // doc_ids
  status: 'proposed' | 'approved' | 'deprecated';
  /** Set ⇒ this record is a merge tombstone; resolve to the canonical id (Section 7). */
  merged_into?: string;
  discovered_by?: { usage_id?: string; model?: string };
  confidence?: number;
  created_at: string;
  last_modified: string;
}

/** Summary row for the entity list/browser (t/1883). Derived from Entity — never forked. */
export type EntitySummary = Pick<Entity, 'id' | 'name' | 'aliases' | 'entity_type' | 'status' | 'confidence' | 'last_modified'>;
/** Query params for GET /api/entities / listEntities (v1: accepted, client-side-filtered — TL t/1766#7 Q6). */
export interface EntityListQuery { search?: string; sort?: string; type?: string; status?: string }

/** Common envelope. `redirected_from` is set when a merged_into tombstone was followed. */
export interface EntityDetailBase { ref: EntityRef; redirected_from?: string }

/**
 * Result of resolving an EntityRef, discriminated on the SAME `kind` field as EntityRef
 * so one switch covers both. Each payload REUSES the type that already owns that data;
 * only `entity` introduces a new shape. `not_found` is a member of the union, not an
 * exception — a resolve miss is a designed outcome. Kind set is `EntityRefKind | 'not_found'`,
 * and `record` is ABSENT (not null) on `not_found` so a pane can't render an empty record.
 */
export type EntityDetail =
  | (EntityDetailBase & { kind: 'node'; record: PovNode })
  | (EntityDetailBase & { kind: 'situation'; record: SituationNode })
  | (EntityDetailBase & { kind: 'policy'; record: PolicyAction })
  | (EntityDetailBase & { kind: 'organization'; record: Organization })
  | (EntityDetailBase & { kind: 'entity'; record: Entity })
  | (EntityDetailBase & { kind: 'term'; record: ColloquialTerm })
  | (EntityDetailBase & { kind: 'not_found' });
