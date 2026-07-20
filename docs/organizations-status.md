# Organizations — End State, Status, and Remaining Work

**Last updated:** 2026-07-12
**Author:** Technical Lead

## End State

Organizations (`org-NNN` IDs) represent real-world actors — labs, regulators, advocacy groups, standards bodies — as a first-class layer on top of the POV taxonomy. The goal is to answer questions the taxonomy alone can't: *who* actually holds a given position, *who* supports or opposes a specific policy action, and *how* actors relate to each other (funding, alliances, competition) — not just how arguments relate to each other.

Three intended capabilities:
1. **POV alignment scoring** — each org gets a per-camp stance score + rationale (e.g., "Anthropic: accelerationist +0.4, safetyist +0.7"), so a user can ask "which real organizations actually hold the accelerationist position on this situation?"
2. **Stakeholder mapping** — reverse lookups from a situation (`sit-*`) or policy action (`pol-*`) to the orgs engaged with it, surfaced directly in policy/situation detail views.
3. **Actor-relationship graph** — a separate 9-type edge vocabulary (`ADVOCATES_FOR`, `OPPOSES`, `SUPPORTS_POLICY`, `OPPOSES_POLICY`, `ENGAGED_WITH`, `PUBLISHED`, `ALLIED_WITH`, `COMPETES_WITH`, `FUNDS`) — distinct from the 8-type argumentation-edge vocabulary — so org-to-org and org-to-node relationships can eventually support coalition/conflict analysis (who's allied with whom, who funds whom).

## Current Status

**Foundational layer: built and populated.**
- Schema + 6 PowerShell cmdlets + registry + tests landed in the founding commit (`f576fa93`, t/1224), with a follow-up integrity fix (`683b5326`, t/1224#4).
- Data is real, not a stub: `../ai-triad-data/taxonomy/Origin/organizations.json` has **25 organizations**, `_schema_version: "1.0.0"`, last modified 2026-07-01. All 9 canonical types are represented (corporate: 7, advocacy: 3, research_lab: 2, civil_society: 3, regulatory: 4, intergovernmental: 1, standards_body: 1, academic: 2, think_tank: 2).
- Sample record (`org-001`, Anthropic) shows the model working as intended: per-camp `pov_alignment` scores with written rationale, `topic_engagement` linking to `sit-*` nodes with a stance, `policy_engagement` linking to `pol-*` with supports/opposes, plus `key_figures`, `source_refs`, `headquarters`, `founded`, etc.

**Full stack wired end to end:**
| Layer | What exists | Commit |
|---|---|---|
| PowerShell | `Get-Organization`, `Find-OrganizationByPOV`, `Find-OrganizationByTopic`, `Get-OrganizationStakeholders`, `Import-Organization`, `Compare-OrganizationPositions`, `Test-OrganizationIntegrity` — all in `scripts/AITriad/Public/`, cached store in `Private/OrganizationsStore.ps1`, atomic writes with rollback-on-integrity-failure, Pester coverage in `tests/Organization.Tests.ps1` | f576fa93, 683b5326 |
| Server storage | `readOrganizations()` reader in `fileIO.ts` | d9c32bb6 (t/1229) |
| Server query layer | Typed parsing + in-memory cache + topic/policy reverse indexes + 5 REST endpoints, `organizations.ts` / `routes/organizations.ts` | c1eda1de (t/1225), 633050e2 (t/1383 refactor) |
| Bridge | Organization query methods on `AppAPI` | 52dd37c8 (t/1226) |
| UI | `OrganizationsTab.tsx` + `OrganizationDetail.tsx`, stakeholders surfaced in policy detail view | 3670cad4, a14e5b7e (t/1227, t/1230), review fixes in 16ea6e3b |

This is a genuinely complete vertical slice — data model → PS cmdlets → server → bridge → UI — not a half-built feature.

**No standalone design doc.** Code comments reference "t/1217 HLD" as the originating design, but no file under `docs/` (or `docs/design/adr/`) corresponds to it — the design lives only in ticket history, not as a discoverable doc.

## Known Gaps

1. **Actor-relationship edges are a validator, not a working feature.** The 9-type `OrganizationEdgeTypes` registry (`Resolve-OrganizationEdgeType.ps1`) exists and is tested, but grepping the entire TypeScript stack for its consumption turns up nothing — no route, no UI, no populated data structure uses it. In the actual data, only 2 of the 9 relationship types are realized in practice, and only indirectly: `topic_engagement` (≈ `ENGAGED_WITH`) and `policy_engagement` (≈ `SUPPORTS_POLICY`/`OPPOSES_POLICY`). `ADVOCATES_FOR`, `OPPOSES`, `PUBLISHED`, `ALLIED_WITH`, `COMPETES_WITH`, and `FUNDS` — the relationships that would actually enable capability #3 (the actor-relationship graph) — have no populated data and no consumer anywhere in the codebase today.

2. **Duplicated `Organization` TypeScript type, already diverging.** Defined independently in `taxonomy-editor/src/server/organizations.ts:22-41` and `taxonomy-editor/src/renderer/bridge/types.ts:68-87`. They're not identical: the server version types `pov_alignment` as `Partial<Record<Pov, PovStance>>` (strict 3-camp union), the bridge version as `Partial<Record<string, OrgPovStance>>` (loose string key). Same shape-duplication pattern already called out for POV summaries elsewhere in this repo (root `AGENTS.md`'s POV Summary Propagation Map) — no shared type today means the next field addition has to be made in two places by hand, and one has already drifted.

3. **UI type filter doesn't match the canonical enum.** `OrganizationsTab.tsx:16` hardcodes `TYPE_OPTIONS = ['advocacy', 'corporate', 'think_tank', 'government', 'academic', 'intergovernmental']` — six values, using `government`. The canonical enum (enforced by `Import-Organization.ps1`'s `ValidateSet`, and what's actually in the data) is nine values, using `regulatory`, not `government`, plus `civil_society`, `standards_body`, and `research_lab` entirely missing from the filter. Concretely: the 4 `regulatory` orgs, all 3 `civil_society` orgs, the 1 `standards_body` org, and both `research_lab` orgs in the real 25-org dataset **cannot currently be found by the UI's own type filter.**

## What Needs to Be Done Going Forward

**Quick, low-risk fixes:**
- Fix `OrganizationsTab.tsx`'s `TYPE_OPTIONS` to the canonical 9-value enum (`regulatory` not `government`, plus the 3 missing values). This is a one-line, single-file, UI-only change — self-certifiable under `/trivial-change`.
- Reconcile the duplicated `Organization` type — either move it to a shared location both server and bridge import, or at minimum align `pov_alignment`'s key type so they don't silently diverge further.

**A real design decision, not a quick fix:**
- Decide whether the actor-relationship edge system (`ALLIED_WITH`, `COMPETES_WITH`, `FUNDS`, `ADVOCATES_FOR`, `OPPOSES`, `PUBLISHED`) is still wanted. Two honest paths: (a) commit to building it out — populate real edge data, add a storage/query layer parallel to the existing topic/policy indexes, surface it in the UI (an org's "allies," "competitors," "funders") — or (b) if capability #3 isn't a near-term priority, say so explicitly and stop carrying an untested, unused 9-type registry as implied scope. Right now it reads as done (schema + validator + tests all exist) but functions as 0% delivered on the actual capability.

**Documentation debt:**
- Write the missing HLD/design doc under `docs/design/adr/` or `docs/` proper, consolidating the ticket-history-only design (t/1217) into something discoverable without git-log archaeology — this document is a status snapshot, not a substitute for that.
