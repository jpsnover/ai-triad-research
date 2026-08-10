# Taxonomy coverage-gap candidate feed (t/2371)

**Author:** Computational Linguist · **Date:** 2026-08-09 · **Ticket:** t/2371 (from t/2341#5, third structural follow-up)
**Status:** v1 — store + schema defined; seeded with adjudication-derived candidates; **automated capture deferred (no signal yet).**

## What this is

The retrieval-quality program closes the loop back to the taxonomy itself: when a key_point expresses a real POV position that **no node covers**, that is a *coverage gap* — fixable only by **authoring a node**, not by retrieval or LLM re-selection. Per the t/2341 adjudication, ~50% of the misfire class is taxonomy-structure, and a real share of that is genuine coverage gaps. This feed captures them for node authoring.

**Boundary with siblings (keep this feed gap-specific):**
- t/2369 — thematic-pillar / grouping-node *mis-assignment* → excluded upstream.
- t/2370 — out-of-scope key_points (not a POV position at all) → routed to `unmapped`, **not** here.
- **This feed (t/2371)** — real POV position, *missing node*.

## Store

- **File:** `candidates.jsonl` (this dir) — durable, appendable, one JSON object per line; distinct from the calibration log.
- **v1 location note:** kept in CL analyses for the manual seed. When automated capture lands, the production store should move to the data repo alongside the calibration log (path TBD with the pipeline owner).

### Schema

Two entry shapes share these fields: `candidate_id`, `entry_type`, `pov_camp`, `correct_home` (null = confirmed gap), `no_home_basis`, `provenance`, `status`.

- `entry_type: "automated_keypoint"` (AC-1 target, not yet emitted): adds `source_doc_id`, `key_point_text` (attribution_text/verbatim), `assigned_node`, `per_keypoint_top3` (nodes + scores). Emitted when Mechanism #5 margin-surfacing fires (`top1 − assigned > 0.06`, t/2357) **and** neither the assigned node nor the top-3 is a correct home.
- `entry_type: "theme_manual"` (this seed): adds `gap_theme`, `gap_description`, `nearest_nodes` (top-3 base cosine + labels), `source_doc_id` (null for theme-level).

### "No correct home" criterion (proxy)

**v1 = CL judgment**, recorded per-entry in `no_home_basis`. This is **not** a stipulated numeric threshold, so there is nothing to add to the metric-provenance register (AC-5: no threshold ⇒ no register row). A numeric proxy is deliberately *avoided*: the seed shows gaps score top-1 **0.43–0.68** — moderate, overlapping both in-scope content and the misfire band (cf. t/2381: "no home" does **not** manifest as low cosine). An absolute-cosine gate cannot separate a coverage gap from a weakly-embedded in-scope claim; only judgment (or a future LLM/human adjudication pass) can. If such a proxy is ever stipulated, register it then.

## v1 finding — automated capture has zero input

**The signal source produces nothing yet.** Grep of the full corpus (`summaries/*.json`) returns **0** key_points carrying `mechanism5_candidates` — no summaries have been (re)generated since t/2357 landed, so the margin-surfacing output is not persisted anywhere. The automated feed (AC-1) therefore has no input. This is the AC-4 "current surfacing volume is insufficient — a valid longitudinal outcome," in its strongest form: not merely low volume but **no persisted signal pending a corpus re-run**.

**Consequence:** building automated pipeline logging now would sit idle. It is deferred until a corpus re-run generates surfacing volume (a pipeline/data operation, not CL-owned). The design above is ready to implement at that point.

## Loop-closure (AC-4) — seeded from the t/2341 adjudication

Four concrete, empirically-checked node-authoring candidates are recorded in `candidates.jsonl` (all safetyist — the adjudication was safetyist-only). Each was re-run through retrieval to confirm no correct home exists among its nearest nodes:

| id | gap | nearest node (score) | verdict |
|---|---|---|---|
| cg-001 | worker-led independent AI risk assessment | saf-intentions-058 @ 0.68 (generic accountability) | gap |
| cg-002 | sovereign/state authority over mission-critical AI | saf-desires-025 @ 0.54 (fiduciary) | gap |
| cg-003 | activation-monitoring prompt-injection detection | saf-beliefs-255 @ 0.49 (CoT forgery / the attack) | gap |
| cg-004 | cap AI informativeness vs knowledge collapse | saf-beliefs-146 @ 0.60 (adjacent risk belief) | gap |

These are routed to node authoring (no dedicated taxonomy-authoring role exists — resolve_owner → root; routed via TL for owner assignment).

## Aggregation (AC-3)

v1 is manual/scripted. When `entry_type: "automated_keypoint"` entries accrue, group by `nearest_nodes[0]` neighborhood / `gap_theme` and surface the top recurring gaps. The 4 seed themes are already distinct (no clustering needed at n=4).

## Disposition

v1 delivered: store + schema + "no-home" criterion + 4 routed candidates + documented zero-automated-signal. **Automated capture (AC-1) remains open, blocked on a corpus re-run producing surfacing signal** — the ticket stays longitudinal. Reprioritize when a re-run happens or a concrete node-authoring cadence is established.
