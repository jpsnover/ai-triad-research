# Bidirectional harvest: situations/conflicts ↔ concepts/entities (t/3233)

**Recommendation: pursue the CONCEPT axis; deprioritize the ENTITY axis.** Conflicts and situations are a rich source of missing *concepts* but a poor source of named *entities* (they are entity-sparse abstractions). Full recommendation + follow-on: t/3233#1.

## Direction A — harvest → taxonomy (LLM extraction, 22 records: 14 conflicts + 8 situations, gemini-3.5-flash-lite)

Run: `python harvest_pilot.py` (needs `GEMINI_API_KEY`). Extracts entities (named particulars) + concepts (universals) per record, checks novelty vs approved `entities.json` surfaces + `dictionary/standardized/` phrases.

| | extracted | distinct | **novel vs taxonomy** |
|---|---|---|---|
| concepts | 178 | 175 | **132** (~6 novel/record) |
| entities | 19 | 17 | 10 (but ~2 real: FOIA, EU AI Liability Proposal; rest are titles/questions/generics) |

Novel concepts are genuine and missing: *attention economy, attentional integrity, autonomous replication, agentic systems, AI-designed bioweapons, biosecurity evasion, academic integrity, …* Noise is present (*AI systems, AI models, AI impact*) → a curation gate is mandatory.

## Direction B — taxonomy → improve situations/conflicts (density over the full corpus)

- Conflicts (1,240): **17%** mention ≥1 approved entity (mean 0.25); debate-sourced **0/16** share an entity across the paired sides → **entity_refs would not sharpen conflict pairing**.
- Situations (443): **37%** surface-match ≥1 dictionary concept (mean 0.53), only **9%** an entity → **concept-grounding situations is the moderate win**; entity-grounding is weak.

## What to do

1. **DO — concept-harvest pass (Direction A):** mine conflicts + situations → candidate concepts → the t/3130 proposer, behind a hard curation gate (dedup vs dictionary → drop generic → embedding near-variant dedup → **human-curate, never auto-add**; the "well-structured space, not an infinite dictionary" rule). Filed as follow-on **t/3234**.
2. **DO (secondary) — concept-ground situations (Direction B):** extend the G7 reconciler's `concept_refs` to `sit-*` nodes (the mini-G1 noted on t/3160).
3. **DON'T** — entity harvest from conflicts/situations, or entity_refs → conflict-pairing. Both entity-sparse; yield doesn't justify a pipeline.

**Caveats:** single-model (gemini-3.5-flash-lite), n=22 records, novelty is surface/substring vs taxonomy (slightly over-counts near-variants — the curation dedup absorbs it). Directional signal, not a precision measurement.
