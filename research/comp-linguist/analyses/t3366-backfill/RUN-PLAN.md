# t/3366 `debate_grounding` corpus backfill — /data-mutation run plan

Prepared by CL so the run is turnkey the moment `Invoke-DebateGroundingBatch` (t/3438, PR #2146) lands. This is the recorded frozen list + authorization + verification plan the /data-mutation playbook requires **before** the corpus write.

## 1. Frozen scope (recorded)

`frozen-scope.json` in this directory. Computed read-only from `ai-triad-data/taxonomy/Origin/{accelerationist,safetyist,skeptic}.json` against the cmdlet's skip logic.

| Camp | POV nodes | already has field | deprecated | short desc | **in scope** |
|---|---|---|---|---|---|
| acc | 202 | 0 | 0 | 0 | **202** (beliefs 89, intentions 87, desires 26) |
| saf | 356 | 0 | 0 | 0 | **356** (beliefs 176, intentions 155, desires 25) |
| skp | 358 | 0 | 0 | 0 | **358** (beliefs 250, intentions 77, desires 31) |
| **total** | **916** | **0** | **0** | **0** | **916** |

Clean scope: every POV node needs generation, no exclusions to reconcile. Situations files are NOT in scope (POV files only).

## 2. Authorization

PI ratified **Option A** — build `debate_grounding`, node-field storage, generate corpus-wide (t/3366#9). Second Opinion **waived by PI** for this additive-optional field (waiver recorded #9). The field/port check (#10) confirmed `graph_attributes.debate_grounding?: string` is already typed (pre-staged under t/3367) — additive-passthrough, no schema ports needed. Per TL (t/3438#3), the PR landing does **not** authorize the run; this run is a separate /data-mutation execution.

## 3. Cost ceiling (state up front)

- **916 LLM calls**, one per node (model `gemini-3.5-flash`, temperature ~0.3, CL's finalized v2 prompt, t/3366#11).
- No per-node embedding writes — the field is a plain string; embeddings are the sidecar's concern, not this field's.
- Skip-if-present keys on non-empty `debate_grounding`, so re-runs after a partial only fill the gaps (cheap).

## 4. Run command (once the cmdlet is on origin/main)

```
cd C:\Users\jsnov\repos\ai-triad-research
$env:AI_TRIAD_DATA_ROOT='C:\Users\jsnov\repos\ai-triad-data'
# 4a. DRY RUN first — no AI, no write, confirms scope + prompt render:
Invoke-DebateGroundingBatch -WhatIf
# 4b. CL sample spot-check (8-10 nodes across camps x BDI) BEFORE the full run:
Invoke-DebateGroundingBatch -Id acc-beliefs-078,saf-desires-012,skp-intentions-131,acc-desires-027,saf-beliefs-140,skp-beliefs-177,acc-intentions-083,saf-intentions-139,skp-desires-075
#   -> CL reviews the 9 written statements (register-fit / grounding-fidelity / no colon-hinge / specificity)
# 4c. Full run only after the spot-check passes:
Invoke-DebateGroundingBatch -Concurrency 4
```

The corpus write is **owner-executed** (like the plain_description backfill) — `ai-triad-data` pushes are gated by the safety classifier, so the PI runs and pushes the result.

## 5. Verification

- **CL spot-check gate (4b):** the sample must pass register-fit (Belief→"We hold that…", Desire→"What matters to us is…"/"We ought to…", Intention→"We will…"), grounding-fidelity (no claims beyond label+description), no colon-hinge / em-dash, and node-specificity — before 4c. This is the same rubric that validated the prompt design (golden check, t/3366#8, 9/9 on register/fidelity/specificity).
- **Second-agent count:** TL is the second-agent counter for the run (t/3438#3). Expected written count = 916 (or 916 minus any the model refuses, which CL inspects).
- **0-collateral proof:** after the write, diff `ai-triad-data` — every changed node shows exactly one added key (`graph_attributes.debate_grounding`), nothing else touched; byte-identical elsewhere. `Update-JsonNodePath -Upsert` (the write primitive, TL-GV'd #2146) re-parse-verifies each splice against an independently-built baseline, so a splice bug refuses rather than corrupts.

## 6. After the backfill

CL runs the A/B: `useDebateGrounding` ON (reads the new field) vs `useSyntheticPhraseGrounding` OFF / baseline — does first-person own-voice grounding improve debate substance? A positive read is also the World-A trigger that lets the t/3432 convergence decision commit (retire the node `synthetic_phrases` layer).
