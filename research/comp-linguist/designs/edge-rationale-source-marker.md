# Edge `rationale_source` Marker — Design / Decision

**Tranche:** follow-up to t/2444 (edge-rationale coverage plan, open-decision #2)
**Author:** Computational Linguist · **Status:** spec for implementation, routed to owners
**Scope:** cross-role — schema/type (Shared Lib), write sites (PowerShell + Shared Lib)

## Problem

Rationale text can reach an edge three different ways, and a reviewer cannot currently
tell them apart: (a) the **contemporaneous discovery reasoning** written when the edge was
created; (b) a **git-restore** of that original text after a data-loss event (the actual
situation — the workflow-app pipeline wiped ~33k discovery-time rationales twice, recoverable
from `ba3128f5`; see the t/2444 correction banner); or (c) a **post-hoc LLM reconstruction**
from node content (the t/2679 backfill, now void). These have very different trust levels —
(a) and (b) are the original justification; (c) is a reconstruction. The field must carry its
own provenance so a reconstruction is never mistaken for the original, and so a restore is
recognisable as such.

## Decision: add a `rationale_source` field on edges

Closed vocabulary (string enum). Absent/empty = **legacy/unknown** (the pre-marker era).

| Value | Meaning | Written by |
|---|---|---|
| `discovery` | LLM classification at edge-discovery time (contemporaneous) | `Invoke-EdgeDiscovery` (per-node + batch LLM paths) |
| `embedding-template` | Templated from similarity; no LLM justified it | `Invoke-EdgeDiscovery` embedding-first path (see plan 2a.3) |
| `reflection` | Emitted by a debate reflection proposal | `debateReflectionSlice` |
| `restore` | Original discovery-time text git-restored after a data-loss event (e.g. from `ba3128f5`) | the restore script (t/2444 correction) |
| `backfill` | Post-hoc LLM reconstruction from node content (last resort; t/2679, now void) | `Invoke-EdgeRationaleBackfill` |
| `human` | Manually authored/edited by a curator | editor / `Set-Edge` when a human sets rationale |
| *(absent)* | Legacy edge, pre-marker | — |

**Invariant:** whenever a writer sets a non-empty `rationale`, it sets `rationale_source`
in the same write. The two fields move together; a rationale without a source is only
valid for legacy rows.

## Implementation (routed)

1. **Shared Lib** — add `rationale_source?: string` to the edge type/schema
   (`lib/edges/*`), and ensure the shared serializers (`serializeEdgesJson`,
   `Write-EdgesFile`) **preserve** it on round-trip (they must already preserve unknown
   fields; confirm with a test). No validation gate here yet — that's the prospective-gate
   tranche (plan 2a, separate).
2. **PowerShell** — `Invoke-EdgeRationaleBackfill` sets `rationale_source = 'backfill'`
   on every edge it writes a rationale onto (one line at the write site, alongside the
   existing `Add-Member`/assign). `Invoke-EdgeDiscovery` sets `discovery` /
   `embedding-template` per path.
3. **Consumer (optional, later)** — `EdgeDetailPanel` badges non-`discovery` sources
   ("backfilled", "templated") so the reader sees provenance at a glance.

## Why a decision doc and not a PR here

The write sites and schema live in PowerShell + Shared Lib scope. CL owns the *decision*
(the vocabulary and the invariant); the owning roles implement. Tickets filed:
- Shared Lib: schema field + serializer-preserve test.
- PowerShell: set `rationale_source` at the three write sites.

Sequencing note: land this marker **before** any full backfill run, else the backfill's
25–33k rows land unlabeled and need a second pass to tag.
