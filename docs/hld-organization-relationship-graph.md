# HLD: Organization Relationship Graph + Type Reconciliation

**Last updated:** 2026-07-12
**Author:** Technical Lead
**Status:** Approved — implementation in progress

## Problem

`docs/organizations-status.md` (2026-07-12) audited the Organizations feature end to end and found a complete, working vertical slice for two of its three intended capabilities (POV alignment scoring, stakeholder mapping) but a gap in the third:

1. **The actor-relationship edge system is a validator with no feature behind it.** `Resolve-OrganizationEdgeType.ps1` defines and tests a 9-type vocabulary (`ADVOCATES_FOR`, `OPPOSES`, `SUPPORTS_POLICY`, `OPPOSES_POLICY`, `ENGAGED_WITH`, `PUBLISHED`, `ALLIED_WITH`, `COMPETES_WITH`, `FUNDS`), but no data file, storage layer, query layer, or UI consumes it. Only 2 of the 9 relationship types are realized today, indirectly, via `topic_engagement`/`policy_engagement` fields on the org record itself.
2. **`Organization` is defined twice and already diverging** — `taxonomy-editor/src/server/organizations.ts:22-41` and `taxonomy-editor/src/renderer/bridge/types.ts:68-87` are independent, hand-maintained copies. `pov_alignment`'s key type has already drifted (`Partial<Record<Pov, PovStance>>` vs `Partial<Record<string, OrgPovStance>>`).
3. **The UI's own type filter doesn't match the canonical enum.** `OrganizationsTab.tsx:16`'s `TYPE_OPTIONS` has 6 stale values (including `government`, which doesn't exist in the data); the canonical 9-value `ValidateSet` enum (`Import-Organization.ps1:48`) is what's actually in the 25-org dataset. 10 of the 25 real orgs (all `regulatory`, `civil_society`, `standards_body`, `research_lab`) cannot be found via the UI filter today.
4. **The Organizations tab has no navigation entry.** `App.tsx:651` already handles `activeTab === 'organizations'`, but no `NAV_ITEMS` entry in `navConfig.ts` ever sets that tab — the feature is fully built and completely unreachable through normal navigation.

## Decision

Full build-out of the actor-relationship edge system (owner-approved 2026-07-12, over the lighter "plumbing only" and "descope" alternatives), plus the three smaller fixes above. Scope, in priority order:

1. Populate real edge data for the 25 existing organizations (not just schema/plumbing).
2. Build a storage + query layer parallel to the existing topic/policy reverse indexes.
3. Surface it in the UI — an org's allies, competitors, and funders, visible from `OrganizationDetail`.
4. Reconcile the duplicated `Organization` type into one shared definition.
5. Fix the UI type filter to the canonical 9-value enum.
6. Add an `organizations` entry to `navConfig.ts`'s `tools` group ("more tools").

## Data Model

### Organization edges file (new)

Parallel to the existing argumentation-edge file (`taxonomy/Origin/edges.json`), mirroring its shape for consistency with the rest of the taxonomy's edge conventions:

`taxonomy/Origin/organization_edges.json`:
```json
{
  "_schema_version": "1.0.0",
  "_doc": "Organization actor-relationship edges. See scripts/AITriad/Private/Resolve-OrganizationEdgeType.ps1 for the 9-type vocabulary. Distinct from edges.json (argumentation edges between claims).",
  "last_modified": "2026-07-12",
  "edges": [
    {
      "source": "org-001",
      "target": "org-014",
      "type": "COMPETES_WITH",
      "rationale": "Free-text justification for this relationship.",
      "source_refs": ["optional array of citation/source ids"],
      "status": "approved",
      "discovered_at": "2026-07-12"
    }
  ]
}
```

- `source` is always an `org-*` id.
- `target` is `org-*` for the 3 org-to-org types (`ALLIED_WITH`, `COMPETES_WITH`, `FUNDS`); `pol-*` for `SUPPORTS_POLICY`/`OPPOSES_POLICY` (already covered by `policy_engagement` — **not duplicated here**, see Non-Goals); `sit-*`/BDI node id for `ADVOCATES_FOR`/`OPPOSES`/`ENGAGED_WITH`; a source/citation id for `PUBLISHED`.
- `type` validated against `Resolve-OrganizationEdgeType` — unknown types are dropped, matching the existing argumentation-edge drop-on-unknown behavior.
- No `confidence`/`model`/`strength` fields (present on argumentation edges) — organization relationships in the seed data are researched/curated facts, not LLM-discovered claims. Add them later only if AI-assisted edge discovery is built for this data (out of scope here).

### Canonical shared TypeScript types (new)

New file `lib/organizations/types.ts` (Shared Lib), the single source of truth both server and renderer import from:

```typescript
export type Pov = 'accelerationist' | 'safetyist' | 'skeptic';
export type PovStance = { score: number; rationale?: string };
export interface TopicEngagement { topic_ref: string; stance?: string; description?: string }
export interface PolicyEngagement { policy_ref: string; stance: 'supports' | 'opposes' }

export interface Organization {
  id: string;
  name: string;
  short_name?: string;
  type?: string;
  description?: string;
  url?: string;
  headquarters?: string;
  founded?: number;
  status?: string;
  pov_alignment?: Partial<Record<Pov, PovStance>>;
  topic_engagement?: TopicEngagement[];
  policy_engagement?: PolicyEngagement[];
  key_figures?: unknown[];
  external_links?: unknown[];
  source_refs?: string[];
  tags?: string[];
  created_at?: string;
  last_modified?: string;
}

export type OrganizationEdgeType =
  | 'ADVOCATES_FOR' | 'OPPOSES' | 'SUPPORTS_POLICY' | 'OPPOSES_POLICY'
  | 'ENGAGED_WITH' | 'PUBLISHED' | 'ALLIED_WITH' | 'COMPETES_WITH' | 'FUNDS';

export interface OrganizationEdge {
  source: string;
  target: string;
  type: OrganizationEdgeType;
  rationale?: string;
  source_refs?: string[];
  status?: string;
  discovered_at?: string;
}
```

`server/organizations.ts` and `renderer/bridge/types.ts` both import `Organization`/`OrganizationEdge` from `@lib/organizations/types` instead of redeclaring — this resolves gap #2 as a byproduct of building #1, rather than as separate cleanup.

## Architecture (by layer)

| Layer | New work |
|---|---|
| PowerShell | New cmdlets `Get-OrganizationEdge` / `Import-OrganizationEdge` (mirroring `Get-Organization`/`Import-Organization`'s cache + atomic-write + integrity-check pattern), backed by a new `Private/OrganizationEdgesStore.ps1`. Backfill real edge data for the 25 existing orgs (curated, not AI-generated — same standard as the existing `pov_alignment` rationale text). |
| Shared Lib | `lib/organizations/types.ts` (above) — prerequisite for every downstream layer, ships first. |
| Server Storage | `readOrganizationEdges()` in `fileIO.ts`, parallel to the existing `readOrganizations()`. |
| ServerAPI | Extend `organizations.ts`'s index-building to add `byAllies`/`byCompetitors`/`byFunders` reverse indexes (or a single `edgesByOrg` index the UI queries and filters by type — simpler, prefer this). New REST endpoint(s) under `routes/organizations.ts`. |
| Taxonomy Editor (bridge) | New `AppAPI` methods (e.g., `getOrganizationEdges(orgId)`) in `types.ts` + `web-bridge.ts` + `electron-bridge.ts`, following `/add-bridge-method`. |
| Taxonomy Editor (UI) | `OrganizationDetail.tsx` gains an "Relationships" section: allies / competitors / funders, each linking to the related org's detail view (reuse the existing org-to-org navigation pattern already used for topic/policy links). |
| Taxonomy Editor (UI, independent) | Fix `TYPE_OPTIONS` in `OrganizationsTab.tsx` to the canonical 9 values. Add `{ id: 'organizations', label: 'Organizations', ..., tier: 'secondary', group: 'tools', action: { type: 'switchTab', target: 'organizations' } }` to `NAV_ITEMS` in `navConfig.ts`. |

## Non-Goals

- **Not duplicating `policy_engagement` as edges.** `SUPPORTS_POLICY`/`OPPOSES_POLICY` are already fully realized via the existing `policy_engagement` field. The edge file's schema reserves these two types for completeness/symmetry with the PS-side registry, but the backfill work only needs to populate the 4 types with zero existing representation: `ADVOCATES_FOR`, `OPPOSES`, `PUBLISHED`, plus the 3 org-to-org types `ALLIED_WITH`, `COMPETES_WITH`, `FUNDS`.
- **No AI-assisted edge discovery** (no `Invoke-EdgeDiscovery`-equivalent for organization edges) in this pass — seed data is hand-curated. Revisit if/when volume grows past what's practical to curate by hand.
- **No graph visualization** (force-directed org graph, etc.) — the UI work here is a list-based "Relationships" section on the existing detail view, not a new visualization surface.

## Work Breakdown

Tracked as a ticket epic with the dependency order: Shared Lib types → (PowerShell backfill run in parallel) → Server Storage reader → ServerAPI query/REST → Taxonomy Editor bridge + UI. The two small independent fixes (nav entry, type filter) have no blockers and can land any time. See ticket epic for acceptance criteria per ticket.
