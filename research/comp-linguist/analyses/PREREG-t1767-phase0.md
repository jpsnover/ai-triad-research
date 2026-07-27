# PREREG — t/1767 Phase 0: Entity-Extraction Go/No-Go Spike

**Ticket:** t/1767 (design: `designs/entity-ontology-proposal.md`)
**Author:** Computational Linguist
**Last updated:** 2026-07-27
**Status:** Preregistered protocol. Committed before any extraction result is read (instrument-effects discipline, `docs/instrument-effects-review.md`).

## What this decides

Whether the entity-extraction approach in the proposal clears the bar to build Phase 1 (schema, types, cmdlets). The spike ships no schema and no code. Decision rules below are fixed before the run.

## Sample (locked)

Deterministic rule: sort all `source_evidence_index.json` keys; stratify by prefix with quota acc=6, saf=6, skp=5, sit=3; within each stratum take every floor(pool/quota)-th key. No substitutions — zero-fact nodes stay in.

Resulting node ids (161 facts total): acc-beliefs-003, acc-beliefs-048, acc-desires-007, acc-intentions-001, acc-intentions-036, acc-intentions-070, saf-beliefs-001, saf-beliefs-034, saf-beliefs-098, saf-desires-024, saf-intentions-038, saf-intentions-087, skp-beliefs-001, skp-beliefs-040, skp-beliefs-115, skp-beliefs-152, skp-intentions-004, sit-001, sit-046, sit-088.

## Instrument (recorded per the replication-gate discipline)

- **Extraction prompt:** v0.1, embedded verbatim below. This is the artifact under test.
- **Model:** claude-fable-5, run as harness subagents. The production path will use a config-driven UsageID and may route a different model; Phase 0 yield/precision numbers are therefore instrument-specific and do not transport. The go/no-go verdict is about the *approach* (prompt + resolution + linking), not the absolute rates.
- **Excluded-class tables:** 44 org names/short_names, 24 dictionary colloquial terms, 1,569 policy action strings, plus taxonomy node labels (checked at scoring time).

### Extraction prompt v0.1

> You are extracting named entities from fact records in an AI-policy research corpus. For each fact's claim text, propose the entities it mentions.
>
> An entity is a PARTICULAR: a specific person, a specific named AI system or tool (artifact), a specific named event, a specific law or regulation or executive order (legislation), or a specific named framework-institution such as a named treaty regime (institution). Do NOT propose universals: concepts, ideas, fields, technologies-in-general, or contested vocabulary such as "alignment", "risk", "oversight". Do NOT propose organizations or companies as new entities; list them separately as org_mentions. Type every proposal as one of: person | artifact | event | legislation | institution.
>
> For each proposal return: name (canonical form), entity_type, aliases (surface forms seen or standard variants), quote (the minimal claim fragment containing the mention), confidence (0.0-1.0 that this is a real, correctly-typed particular). Also return org_mentions: organization/company names seen (they resolve to an existing org registry, not to new entities). Emit every candidate you see and let confidence carry your doubt; do not self-censor borderline items below 0.3 — emit them at their honest confidence.

## Definitions (fixed)

- **Proposal:** one (name, entity_type, aliases, quote, confidence) tuple, after within-run exact-name dedup.
- **Confidence gate:** 0.6 (stipulated). Proposals at or above the gate are "gated proposals"; only they are scored for precision and leakage.
- **Yield:** distinct gated proposals / facts processed.
- **Precision (CL hand-score):** a gated proposal is correct iff (a) it denotes a real particular, not a universal; (b) `entity_type` is correct; (c) the name is well-bounded (not a fragment or a whole clause). Score = correct / gated.
- **Excluded-class leakage:** a gated proposal whose name or alias case-insensitively matches an org name/short_name, a dictionary colloquial term, a taxonomy node label, or a policy action string, and which the resolution step fails to route to a link instead of a new entity. Org names emitted inside `org_mentions` are correct behavior, not leakage.
- **Detect→link exercise:** 3 statements drawn from one real debate session (`debates/debate-*.json`, first session file by sorted name with ≥3 speaker statements; statements 1, 2, 3 by transcript order). CL hand-annotates entity mentions first, then runs alias detection against the spike's gated proposals plus the org table. A mention counts as linked iff detection finds it and resolves to the right referent; ambiguous mentions correctly left unlinked count as refusals, not errors.

## Go/No-Go rules (fixed before the run)

GO to Phase 1 iff ALL of:
1. Precision ≥ 0.80 on gated proposals.
2. Leakage = 0 (the resolution step catches every excluded-class collision).
3. Yield ≥ 0.15 gated proposals per fact (≥ 24 distinct entities from 161 facts).
4. Detect→link: ≥ 80% of hand-annotated mentions in the 3 statements detected and correctly resolved, with 0 wrong links (refusals allowed).

Any single failure = NO-GO on that axis; the result section must say which axis failed and what the fix hypothesis is before any re-run. A re-run with a modified prompt is a new instrument version and gets a fresh section, not an edit to this one.

All thresholds are **stipulated** (this is a spike; nothing enters the provenance register until an implementing PR ships a production threshold).

---

## Results (run of 2026-07-27, protocol v0.1 — recorded after the preregistered rules above)

Run artifacts: `_p0_out_A.json`, `_p0_out_B.json`, `_p0_out_C.json` (extraction outputs), `_p0_annotation.json` (CL hand-annotation, written before any batch output was read), `_p0_statements.json`, `_p0_score.py` (mechanical scorer), all under `analyses/p0-t1767/`.

| Axis | Rule | Result | Verdict |
|---|---|---|---|
| 1. Precision | ≥ 0.80 on gated | 54 proposals → 40 gated after dedup; hand-score 39/40 = **0.975** (A 5/5, B 26/26, C 8/9) | PASS |
| 2. Leakage | 0 | Mechanical check vs 44 org names, 24 dictionary terms, 1,569 policy actions, 1,310 taxonomy labels: **0** | PASS |
| 3. Yield | ≥ 0.15/fact | 40/161 = **0.248** | PASS |
| 4. Detect→link | ≥ 80% detected+resolved, 0 wrong links | 1 hand-annotated mention ("the 2008 financial crisis"); detections **0/1**; wrong links **0** across all 3 statements | **FAIL** |

**Formal verdict: NO-GO as preregistered** (rule: any single axis failure). Failed axis: 4.

**Analysis of the axis-4 failure.** The single annotated mention does not occur anywhere in the 20-node facts sample, so the spike's alias table cannot contain it; the detector was asked to find an entity its table had no entry for. Two observations separate approach from harness:

1. What axis 4 could legitimately test — the refusal property — **held**: zero wrong links across three ~2,000-char statements against an 84-alias table, including heavy contested-vocabulary text ("strict liability", "oversight", "frontier") that a sloppier detector would have matched.
2. The miss is a **coverage artifact of the spike harness**, not of the design: the production alias table comes from full-corpus extraction plus the retroactive re-index pass (proposal §7), neither of which a 20-node slice can emulate. Axis 4 as written conflated detector correctness with table coverage — an instrument-design flaw of this protocol, of exactly the kind `docs/instrument-effects-review.md` warns about. The flaw is disclosed, not repaired retroactively.

**Fix hypothesis + proposed re-run (requires a fresh protocol section per the rules above, before any Phase 1 decision):** protocol v0.2 re-runs axis 4 only, against an alias table built from the facts of the nodes the selected debate actually references (a full-corpus proxy), with the same annotation and scoring rules. Axes 1–3 stand as measured; the extraction instrument itself is validated on this sample.

**Type-taxonomy note for Phase 1:** the one precision miss (Rome Call for AI Ethics typed `institution`; correct reading is normative description → `legislation` bucket) and one sub-gate near-miss (FTC v. Rite Aid as `event`) suggest the prompt's teaching text should sharpen the legislation/institution differentia and note that legal cases ride the `event` bucket until the mint gate admits a `case` type (≥10 observed instances).
