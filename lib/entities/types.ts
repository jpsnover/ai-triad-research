// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonical cross-stack entity reference (t/1767 §5 contract). Single home for the
// ref-kind discriminated union — consumed by the server (getEntity) and the renderer
// (resolveRef / DetailPane, t/1775, which IMPORTS this and never forks it). Shipped
// interface-first so the five consumers build in parallel.

/** The kinds of linkable target an EntityRef can point at. */
export type EntityRefKind = 'node' | 'situation' | 'policy' | 'entity' | 'term';

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
  | { kind: 'entity'; id: string }      // ent-* | org-*
  | { kind: 'term'; id: string };       // vocabulary; wire form `term:<slug>`

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
  if (raw.startsWith('ent-') || raw.startsWith('org-')) return { kind: 'entity', id: raw };
  if (NODE_ID_RE.test(raw)) return { kind: 'node', id: raw };
  return null;
}

/** Type guard for a valid {@link EntityRefKind} string. */
export function isEntityRefKind(x: string): x is EntityRefKind {
  return x === 'node' || x === 'situation' || x === 'policy' || x === 'entity' || x === 'term';
}
