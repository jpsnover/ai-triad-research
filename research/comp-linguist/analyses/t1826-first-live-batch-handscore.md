# t/1826, First Live Entity-Extraction Batch, Hand-Scored

**Author:** Computational Linguist
**Date:** 2026-07-28
**Run:** 25 nodes via `Invoke-EntityExtraction -MaxNodes 25`, UsageID `enrichment.entity-extraction` (claude-sonnet-4-6), defaults: confidence gate 0.6, near-gate band 0.1, linking cosine 0.60. Data written to `taxonomy/Origin/entities.json` (data-repo commit `ab99f083` includes the alias repair below) and the `entity_extraction_log.json` sidecar.
**Rubric:** Phase 0's correctness definition, reused verbatim (`analyses/PREREG-t1767-phase0.md`): a proposal is correct iff it names a real entity of the typed class, the name is right, the source fact supports it, and it is not an excluded class (org names/short_names, `pol-*` action titles, taxonomy labels, dictionary terms). No new scoring stipulations were introduced.

## Headline counts

| Measure | Count | Rate |
|---|---|---|
| Nodes processed / skipped (no facts) | 25 / 126 | — |
| Proposals | 41 | — |
| Minted | 37 | — |
| Linked (within-run dedup) | 1 | correct (GPT-4) |
| Dropped below gate | 3 | not persisted, unscoreable |
| Near-gate minted [0.6, 0.7) | 2 | both correct |
| Invalid / failed | 0 / 0 | — |
| **Entity-level precision (minted)** | **37/37** | **1.000** |
| **Record-level integrity (minted)** | **24/37** | **0.649** |
| Person-exception compliance | 4/4 | 1.000 |
| Excluded-class leakage | 0/37 | 0.000 |

The two-level split is the finding. Every minted entity is real, correctly typed, source-supported, and outside all four excluded classes. But 13 of 37 records left the pipeline with their alias arrays exploded into per-character elements.

## How the scoring was done

World-knowledge verification for famous entities (Apollo Project, Manhattan Project, GPT-2/3/4/4o/5, o1/o3/o3-mini/o4-mini, Claude/Claude 3, InstructGPT, PPO, EWC, F-16, Trump, Maduro, Warwick, I. J. Good, ERCOT, LegalBench). For the eleven less-famous names (GLM-TTS, DeepRetrieval, ReZero, SituationalLLM, GenAI.mil, Fortune AIQ 50, the Beethoven quartet, the AI-controlled F-16 exercise, Stargate, the Dec-2025 AI Executive Order, Office Agent), each was grep-verified against its verbatim appearance in `source_evidence_index.json` facts. Excluded-class checks were exhaustive name matches against organizations.json (with short_names), all four taxonomy files' labels (1,310), the 90 dictionary canonical/display forms, and 1,569 policy action strings. Two type calls required judgment, and both are defensible (Stargate as `event`/perdurant for a project; the Executive Order as `legislation` covering legal instruments).

The `quote` field the schema requests was captured by the cmdlet but never persisted (defect 2 below), so source-support had to be re-derived from the evidence index rather than read off the record. That cost is itself evidence for fixing the defect, because curation will face the same gap on every record.

## Defects found (all in the extraction pipeline, none in the prompt/instrument)

1. **Alias char-explosion (13/37 records).** When the model emits `aliases` as a bare JSON string instead of an array (which it did every time there was exactly one alias), the pipeline explodes the string into per-character array elements ("PPO" carried 28 single-character aliases spelling "Proximal Policy Optimization"). Every multi-alias record is clean; every single-alias record was exploded. The likely mechanism is PowerShell string indexing (`$s[i]` yields chars), a missing string-vs-array coercion at the alias read site in the exact `normalize-at-fetch` class. Left unrepaired this poisons linking, since a single-character alias would cosine/alias-match almost anything. **Data repaired deterministically** (rejoin, data-repo commit `ab99f083`); the code fix is PowerShell's.
2. **Quotes not persisted.** `quote` flows through the run object and is dropped before `entities.json`. The person-exception design routes person records into curation with "alias candidates + supporting quote"; the quote never arrives. Affects all types, not just persons.
3. **Below-gate drops not persisted.** The 3 dropped proposals exist only in the run's console summary, so gate recall (did the gate drop anything good?) is unmeasurable. A small `dropped[]` section in the sidecar log would make the gate auditable.

## Register implications (applied in the same commit set)

- **Confidence gate 0.6: stays stipulated.** Precision at the gate measured 1.000 (n=37), but a zero-error batch yields a degenerate confidence-vs-correctness curve; there is nothing to tune a threshold against, and n is small. The measured batch is recorded as evidence on the row; promotion needs either a larger batch with errors to shape the curve or several clean batches at meaningfully larger n.
- **Linking cosine 0.60: stays stipulated, no movement.** One link happened (within-run dedup, correct); n=1 is no evidence about the threshold.
- The person-exception and excluded-class mechanisms both held at 4/4 and 0/37 in their first live contact.

## Curation notes (for whoever reviews the 37 proposals)

- `Claude` (ent-034) and `Claude 3` (ent-021) minted separately; defensible as distinct, a merge candidate at curation.
- All descriptions are empty **by design**; the responseSchema requests none, and genus-differentia descriptions are authored at curation (persons mandatorily so).
- ent-035 (`Nicolás Maduro`) is byte-correct UTF-8 in the store; any mojibake is console rendering.
