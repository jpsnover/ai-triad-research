// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1786 (ServerAPI) — GET /api/entity/:ref, the server consumer of the
// cross-stack entity-ref contract (t/1767 §5, shipped in lib/entities/types.ts).
// One public read endpoint (no auth gate, like /api/organizations) that parses a
// raw ref token to a typed EntityRef and resolves it to the record type that
// already owns that kind's data, returning the EntityDetail result union. The
// contract is IMPORTED, never forked — parseEntityRef + EntityDetail come from
// lib/entities/types.js.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import type { PovNode, SituationNode } from '../../../../lib/debate/taxonomyTypes.js';
import type { PolicyAction } from '../../../../lib/policy/types.js';
import type { ColloquialTerm } from '../../../../lib/dictionary/types.js';
import type { Entity, EntityDetail, EntityRef } from '../../../../lib/entities/types.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { parseEntityRef } from '../../../../lib/entities/types.js';
import * as fileIO from '../storage/fileIO.js';
import { getOrganizationById } from '../organizations.js';

// Depth cap for the merged_into tombstone chase (Section 7). A well-formed merge
// graph is a short chain; anything past this is corrupt data, not deep nesting.
const MAX_MERGE_DEPTH = 16;

/** Map a POV-node id prefix (acc/saf/skp) to its taxonomy file key. null = unknown. */
function povFileForNodeId(id: string): string | null {
  const prefix = id.split('-')[0];
  if (prefix === 'acc') return 'accelerationist';
  if (prefix === 'saf') return 'safetyist';
  if (prefix === 'skp') return 'skeptic';
  return null;
}

/** A resolve miss — the `not_found` member of the union (no `record` field). */
function notFound(ref: EntityRef, redirectedFrom?: string): EntityDetail {
  return redirectedFrom === undefined
    ? { ref, kind: 'not_found' }
    : { ref, redirected_from: redirectedFrom, kind: 'not_found' };
}

/** Pull the `.nodes` array out of a taxonomy file (both POV + situations files
 *  wrap their records under `nodes`). Tolerates a bare array as a fallback. */
function nodesOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const nodes = (data as { nodes?: unknown })?.nodes;
  return Array.isArray(nodes) ? (nodes as Record<string, unknown>[]) : [];
}

/** Pull the policy-action array out of the registry. Production shape is
 *  `{ policies: [...] }`; also tolerate `{ policy_actions: [...] }` or a bare
 *  array so a schema rename doesn't silently 404 every policy. */
function policiesOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const d = data as { policies?: unknown; policy_actions?: unknown } | null;
  const arr = d?.policies ?? d?.policy_actions;
  return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
}

/** Slugify a colloquial term into the `term:<slug>` wire form: lowercase,
 *  non-alphanumeric runs → single hyphen, trimmed. Deterministic and reversible
 *  enough that "labor displacement" ⇔ "labor-displacement". */
function slugifyTerm(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface MergedIntoResult {
  /** The terminal (non-tombstone) record the chain resolves to. */
  record: Entity;
  /** The originally-requested id, set only when ≥1 merge pointer was followed. */
  redirectedFrom?: string;
}

/**
 * Follow an Entity's single canonical `merged_into` tombstone pointer (Section 7)
 * to the terminal record, recording the original id as `redirectedFrom` once any
 * hop is taken. Returns null if any id in the chain is absent. Throws
 * {@link ActionableError} on a cycle or when the chain exceeds `maxDepth` — both
 * indicate corrupt merge data, not a deep-but-valid graph. Organizations have NO
 * merged_into, so this is entity-only.
 */
export function resolveMergedInto(
  id: string,
  lookup: (id: string) => Entity | null | undefined,
  opts: { maxDepth: number },
): MergedIntoResult | null {
  const seen = new Set<string>();
  let currentId = id;
  let redirectedFrom: string | undefined;

  for (let depth = 0; depth <= opts.maxDepth; depth++) {
    if (seen.has(currentId)) {
      throw new ActionableError({
        goal: 'Resolve a merged entity to its canonical record',
        problem: `merged_into chain forms a cycle at "${currentId}" (started from "${id}")`,
        location: 'server/routes/entity.ts → resolveMergedInto',
        nextSteps: [
          'Inspect entities.json for a merged_into loop (A→B→A) starting at this id',
          'Break the cycle so exactly one record in the chain has no merged_into',
        ],
      });
    }
    seen.add(currentId);

    const rec = lookup(currentId);
    if (!rec) return null; // a hop points at a missing id → unresolved
    if (!rec.merged_into) return { record: rec, redirectedFrom };

    redirectedFrom = redirectedFrom ?? id; // first hop: remember where we started
    currentId = rec.merged_into;
  }

  throw new ActionableError({
    goal: 'Resolve a merged entity to its canonical record',
    problem: `merged_into chain from "${id}" exceeded the depth cap (${opts.maxDepth})`,
    location: 'server/routes/entity.ts → resolveMergedInto',
    nextSteps: [
      'Verify the merge graph is a short chain, not a deep or unbounded one',
      `If a legitimately long chain exists, raise MAX_MERGE_DEPTH (currently ${opts.maxDepth})`,
    ],
  });
}

/**
 * Best-effort load of the entity registry (ent-* records) as an id→Entity map.
 *
 * DEFERRED (t/1786): entities.json does not exist yet — the §3 Entity record and
 * its storage land in a follow-up. Until then this returns null, so the `entity`
 * branch below always resolves to not_found. When entities.json ships, replace
 * this body with a fileIO read (a `readEntityRegistry()` storage method, Server
 * Storage scope) building the Map; the `resolveMergedInto` wiring below then goes
 * live unchanged.
 */
async function loadEntityRegistry(): Promise<Map<string, Entity> | null> {
  return null;
}

export function registerEntityRoutes(r: Router, _ctx: ServerCtx): void {
  const { get } = r;

  // GET /api/entity/:ref — public read: resolve any entity-ref token to its record.
  get('/api/entity/:ref', async (req, res) => {
    const raw = param(req, 'ref', '/api/entity/:ref');
    try {
      const ref = parseEntityRef(raw);
      // Malformed / unrecognized token = a client bug (an unbuildable ref should
      // never be requested) → 400, not a not_found result.
      if (!ref) { error(res, `Malformed or unrecognized entity ref: "${raw}"`, 400); return; }

      switch (ref.kind) {
        case 'organization': {
          const org = await getOrganizationById(ref.id);
          // Organization has NO merged_into — no tombstone chase here.
          json(res, org ? { ref, kind: 'organization', record: org } : notFound(ref));
          return;
        }

        case 'policy': {
          const registry = await fileIO.readPolicyRegistry();
          const found = policiesOf(registry).find(p => p.id === ref.id);
          json(res, found ? { ref, kind: 'policy', record: found as unknown as PolicyAction } : notFound(ref));
          return;
        }

        case 'node': {
          const povFile = povFileForNodeId(ref.id);
          if (!povFile) { json(res, notFound(ref)); return; }
          const data = await fileIO.readTaxonomyFile(povFile);
          const found = nodesOf(data).find(n => n.id === ref.id);
          json(res, found ? { ref, kind: 'node', record: found as unknown as PovNode } : notFound(ref));
          return;
        }

        case 'situation': {
          // sit-* and cc-* both live in the situations file (readTaxonomyFile
          // resolves situations.json → cross-cutting.json, whichever exists).
          const data = await fileIO.readTaxonomyFile('situations');
          const found = nodesOf(data).find(n => n.id === ref.id);
          json(res, found ? { ref, kind: 'situation', record: found as unknown as SituationNode } : notFound(ref));
          return;
        }

        case 'term': {
          // Wire form is `term:<slug>`; slug maps to a ColloquialTerm by slugifying
          // its colloquial_term. If two terms collide onto the same slug the mapping
          // is ambiguous → not_found (refusal discipline; never guess a target).
          const slug = ref.id.slice('term:'.length);
          const colloquial = (await fileIO.loadDictionary()).colloquial as ColloquialTerm[];
          const matches = colloquial.filter(t => slugifyTerm(t.colloquial_term ?? '') === slug);
          json(res, matches.length === 1 ? { ref, kind: 'term', record: matches[0] } : notFound(ref));
          return;
        }

        case 'entity': {
          // DEFERRED (t/1786): entities.json is not shipped yet — loadEntityRegistry
          // returns null, so this resolves to not_found today. The resolveMergedInto
          // wiring is live-but-inert: it activates automatically once the registry
          // loads, following a merge tombstone to the canonical record and stamping
          // redirected_from.
          const registry = await loadEntityRegistry();
          if (!registry) { json(res, notFound(ref)); return; }
          const resolved = resolveMergedInto(ref.id, id => registry.get(id) ?? null, { maxDepth: MAX_MERGE_DEPTH });
          if (!resolved) { json(res, notFound(ref)); return; }
          json(
            res,
            resolved.redirectedFrom === undefined
              ? { ref, kind: 'entity', record: resolved.record }
              : { ref, redirected_from: resolved.redirectedFrom, kind: 'entity', record: resolved.record },
          );
          return;
        }

        default: {
          // Exhaustiveness guard (t/1786 fast-follow, TL): every EntityRefKind has a
          // case above. If the union grows, `ref` here stops being `never` and this
          // assignment fails to COMPILE — forcing the new kind to be handled rather
          // than silently falling through to a hung request. Unreachable today; the
          // throw routes through the catch below (flight-recorder + 500) if it ever is.
          const _exhaustive: never = ref;
          throw new Error(`Unhandled entity ref kind: ${JSON.stringify(_exhaustive)}`);
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: `Failed to resolve entity ref "${raw}"`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
