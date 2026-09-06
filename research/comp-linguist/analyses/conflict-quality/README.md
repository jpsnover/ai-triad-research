# Conflict-corpus quality — the 432 standalone-fact demotion (t/3339)

The conflict corpus mis-tags ~432 single-instance "conflicts" that are actually **standalone facts** (neutral stats,
definitions, dates — no opposition). This is the CL-verified frozen list for PS's surgical demotion tool.

## Files
- **standalone-facts-432.json** — the frozen list PS's tool reads at runtime. Shape:
  `{_meta{...}, standalone_facts:[{conflict_id, reason, provenance}]}`. Iterate `standalone_facts[].conflict_id`.
- `build_432_list.py` — builds the list from the singleton classification.
- `verify432-worksheet.md` — the 40-item blind verification sample.

## Verification (CL upstream gate)
Blind 40-sample precision spot-check: **39 genuine standalone facts / 1 contestable** = **precision 0.975, Wilson95 LB 0.871**.
The classification is highly reliable. The ~2.5% residual are borderline-contestable technical theses (e.g. "hallucinations
statistically inevitable"); acceptable because the demotion is **reversible**.

## Demotion semantics (locked with PS)
**Reclassify, do not remove:** `status=demoted`, `claim_type=non_conflict`, `demotion.reason=standalone_fact` + CL provenance;
**keep the instance record** as a claim/evidence entry. Reversible. No qbaf recompute (metadata only, no edges).

## Ownership + guardrails
- CL owns the conflict-definition criteria + this verified list; PS owns the surgical apply tool (`scripts/`, PS scope).
- The tool touches ONLY these 432 ids, 0-collateral — the 15 fork-B edges and all real conflicts stay byte-identical.
- dry-run → owner `--write` (data_tree_guard).
