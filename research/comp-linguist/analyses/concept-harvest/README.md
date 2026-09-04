# Concept-harvest pass (t/3234, from t/3233)

Mines `conflicts/conflicts.json` + `situations.json` for candidate CONCEPTS (universals/topical kinds)
missing from the dictionary, and produces a **PI curation worksheet** feeding the t/3130 concept proposer.
**Propose only — never auto-adds** to the dictionary (PI "well-structured space, not an infinite
dictionary" rule).

Not for entity harvest: t/3233 found conflicts/situations entity-sparse; this pass extracts concepts only.

## Pipeline

1. **`harvest_concepts.py`** (stage 1) — LLM-extracts concepts from every record (1240 conflicts + 443
   situations), then the cheap curation-gate layers: lexical novelty vs the dictionary + drop-generic +
   frequency aggregation → `harvest_candidates.json`.
2. **`harvest_stage2.py`** (stage 2) — the **reuse gate** (freq ≥ 3: a concept must recur in ≥3 source
   records to be reusable) + a stronger drop-generic filter + **MiniLM embedding dedup** (nearest existing
   dictionary concept per candidate; intra-candidate near-duplicate clustering) → the worksheet.

## Funnel (this run)

```
8,280 raw extractions
6,091 distinct
  −1,632 already in the dictionary (lexical)
freq ≥ 3 reuse-gate → 193
  −21 generic ("AI agents", "generative AI", "model performance", …)
embedding near-dup clustering → 166 candidate concepts (161 NEW, 5 near-existing)
```

The freq-1/2 long tail (≈3,900 one-off extractions) is dropped by the reuse gate — one-off concepts are
noise under the reuse discipline, not dictionary material.

## Output → curation

`concept-harvest-worksheet.md` — 166 candidates ranked by frequency, each with its nearest existing
dictionary concept (MiniLM cosine), a `NEW`/`NEAR-EXISTING` suggestion, and merged near-duplicate variants.
**PI sets `VERDICT` per row** (`accept` new / `merge` into nearest / `reject`); accepted concepts flow to
the t/3130 proposer + `dictionary/standardized/`. `concept-harvest-final.json` is the machine-readable form.

`NEAR-EXISTING` = MiniLM cosine ≥ 0.80 vs an existing concept (likely already covered). Note the dictionary
is small (54 concepts), so most candidates read as `NEW` at low cosine — the worksheet is a proposal
surface for human judgment, not an accept list.

## Reproduce

```
python harvest_concepts.py      # stage 1 (paid: flash-lite over 1683 records)
python harvest_stage2.py        # stage 2 (MiniLM embed; reads harvest_candidates.json)
```
Reads `$AI_TRIAD_DATA_ROOT` (default: sibling `ai-triad-data`). Sampling/aggregation deterministic;
LLM extraction is temperature-0.2 so candidate sets vary slightly run-to-run (the freq gate is robust to it).
