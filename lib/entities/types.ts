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

/** The new entity record (ent-*), stored in entities.json. */
export interface Entity {
  id: string;                     // ent-NNN
  name: string;
  aliases: string[];
  entity_type: EntityType;
  dolce_category: DolceCategory;
  /** Genus-differentia: "A [type] that [differentia]...". Human-authored for `person`. */
  description: string;
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
