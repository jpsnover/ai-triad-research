# Gap-Backfill Prompt — 179 post-wipe edges (t/2946 Phase 2)

**Ticket:** t/2946 Phase 2 · **Author:** CL.Investigate1 · **Parent:** t/2444
**Scope:** the **179** edges that have no source in `ba3128f5` (created *after* wipe #1, so the
git-restore in t/2946 Phase 1 cannot cover them). This is the *only* cohort that needs
generation — 0.5% of edges, not 33k.

## Why this is rationale-*only*, not re-discovery

These 179 rows already exist as edges: their `source`, `target`, `type`, `confidence`, and
`weight`/`strength` were decided at discovery time. Only `rationale` is missing. So — unlike
`Invoke-EdgeDiscovery`'s classify prompt (which *chooses* type + direction) — this prompt is
handed the fixed relationship and asked to **explain the already-committed edge**. Do not let the
model re-classify, flip direction, or second-guess the type; it justifies, it does not decide.

## Provenance (load-bearing)

A backfilled rationale is a **post-hoc reconstruction** from node content, not the contemporaneous
discovery reasoning. Provenance class: **derived** (not human-validated, not the original
stipulation). Every edge this prompt fills MUST be tagged **`rationale_source: "backfill"`** so it
is never mistaken for a discovery-time or restored (`rationale_source: "restore"`) rationale — per
CL Main's `rationale_source` marker spec (Shared-Lib t/2943 / PowerShell t/2944). Update
`docs/metric-provenance-register.md` in the landing PR.

## Input assembly (per edge)

From the POV node files (`taxonomy/Origin/{accelerationist,safetyist,skeptic,cc}.json`), nodes
carry `id`, `label`, `description`, `category`. From `edges.json`, the edge carries the fixed
`type`, plus `confidence` / `weight` as strength hints. Assemble:

```
SOURCE  [<source.id>] <source.label> (<source.category>): <source.description>
TARGET  [<target.id>] <target.label> (<target.category>): <target.description>
EDGE    type=<type> — <edge_type.definition>   (confidence <confidence>, weight <weight>)
```

## Prompt template

```
You are documenting WHY an already-established relationship exists between two taxonomy nodes.
The relationship type and direction are FIXED and correct — do not question, re-classify, or
reverse them. Write only the missing rationale.

SOURCE  [{source_id}] {source_label} ({source_category}): {source_description}
TARGET  [{target_id}] {target_label} ({target_category}): {target_description}
RELATIONSHIP (fixed): {source_id} --{type}--> {target_id}
  {type}: {type_definition}

Write one sentence (max ~40 words) stating why the SOURCE stands in this {type} relationship to
the TARGET, grounded in the two descriptions above. Quote or paraphrase the specific content that
licenses the relationship. Do not restate the node labels verbatim; do not hedge ("may", "could
be seen as") unless the descriptions themselves are tentative. If the descriptions genuinely do
not support the {type} relationship, return exactly: INSUFFICIENT_BASIS

Return JSON only, no markdown fences: {"rationale": "..."}
```

## Output handling

- Parse `{"rationale": "..."}`; write it into the edge and set `rationale_source: "backfill"`.
- **`INSUFFICIENT_BASIS`** → leave `rationale` empty, do **not** fabricate. Flag the edge for CL
  review (a real signal: an edge whose own node content doesn't justify it may be a bad edge, not
  just a missing rationale). Count and report these, per the `Invoke-EdgeDiscovery` silent-blank
  convention (t/2674) — a run that quietly produces blanks must surface the count.
- Never emit a rationale that merely echoes the labels; the harness screens for this.

## Verification (gate before landing)

Every backfilled rationale runs through CL Main's rationale-quality harness (PR #1426, repurposed
as restore/backfill verifier) — same screen as the restored set. Only harness-passing rationales
land. `INSUFFICIENT_BASIS` and harness-rejected rows route to CL review, not to auto-fill.

## Model / cost

Free-tier `gemini-flash-lite` (the discovery-era model for this cohort: 119 gemini-3.5-flash-lite,
50 gemini-2.5-flash, 10 debate-reflection). 179 edges × ~700 in / ~60 out tokens ≈ trivial;
effectively $0. Batch by `type` to maximize prompt-cache hits. No paid model is warranted at this
volume.

## Sequencing

Runs **after** t/2946 Phase 1 (git-restore) and **after** t/2945 lands the pipeline fix — same
reason: a full-tree pipeline run before the fix would wipe these too (killed t/2679).
```
