# t/1878 — Confirming live entity-extraction batch, hand-scored (Phase-1 exit gate)

**Author:** Computational Linguist
**Last updated:** 2026-07-28
**Build:** origin/main `ddd77772` (verified ancestors: t/1830 `97797849`, t/1834 `37598a6f`) — AC 1.
**Run:** 25 fresh nodes (no `-Force`; independent sample, not a t/1826 replay), `claude-sonnet-4-6`, concurrency 3. Result: 46 proposals → 41 minted (`ent-038`…`ent-078`), 4 linked, 1 dropped below gate, 0 invalid, 0 failed. Skipped: 126 no-facts, 25 already-done.

## Fix confirmations (ACs 2–4, 7) — all three t/1830 fixes confirmed live

- **Alias coercion (AC 2):** post-run `entities.json` has 78 records; **0 exploded-alias records** (≥5 single-char aliases); **35 single-alias records (22 from this batch), none of them a 1-character alias** — the exact 13/37 failure class from batch #1 is clean. *(Correction, TL ratification t/1878#3: originally stated as 67 — that count coerced 32 zero-alias records into the single-alias bucket via `@($null).Count -eq 1`; those are vacuous for this check. Recounted null-safe: 32 zero / 35 single / 22 this batch. Verdict unchanged.)*
- **Quote persistence (AC 3):** log `_schema_version` **1.1.0**; `nodes[]` (note: **now an array**, was a dict at 1.0.0) carries `evidence[]` with `{id, name, quote}` — 41 entries across 14 nodes, one per minted entity, **zero empty quotes**.
- **Below-gate drops (AC 4):** `dropped[]` persisted with `{node_id, name, entity_type, confidence}` — 1 entry (`acc-intentions-004` / "Self-correcting search" / artifact / 0.45).
- **Get-Tax regression (AC 7):** clean after the batch wrote the 1.1.0 log — 1322 nodes listed, single-id lookup fine, no exception.

## Hand-score (AC 5)

Method: every minted entity reviewed against the t/1767 typology (particular-not-universal; 5 types; orgs link-don't-mint; DOLCE tag; grounded quote). Quote grounding checked mechanically against `source_evidence_index.json` fact claims (60-char verbatim probe).

- **Grounding: 41/41.** 40 verbatim; `ent-038` (Waymo digital twin) differs only by apostrophe normalization (curly `’` in the fact, straight `'` in the quote). Zero hallucinated or unsupported quotes.
- **Particular-vs-universal: 41/41.** No universals minted.
- **Excluded-class leakage: 0/41.** `ent-077` CAISI looks like an org-leak but is **correct**: CAISI is absent from `organizations.json` (0 name/short_name matches), so there was nothing to link — minting as `institution` is the designed behavior. (Observation, not defect: when Organizations later adds CAISI, the merge/redirect machinery owns the reconciliation.)
- **Type correctness: 40/41.** One error: `ent-049` "Trump Administration AI Action Plan (July 2025)" typed `artifact/non-agentive-functional-artifact`; the same referent minted from another node (`ent-076`) is typed `legislation/normative-description`, which is the correct call for an executive policy instrument. Charged as one type error against `ent-049`.

**Entity-level precision at the 0.6 gate: 40/41 ≈ 0.976** (batch #1 baseline: 37/37 = 1.000; cumulative 77/78 ≈ 0.987). Still a zero-hallucination instrument; the single error is a type-boundary call (document-artifact vs normative-instrument), useful prompt-guidance signal, not a gate-threshold signal.

**Record-level integrity: 39/41 unique.** Two within-run duplicate pairs the dedup missed:
1. `ent-049` "Trump Administration AI Action Plan (July 2025)" ↔ `ent-076` "AI Action Plan" — **`ent-076`'s name exactly equals an alias of `ent-049`** ("AI Action Plan"), so the alias table should have caught it; `ent-049` (lower id) was minted first, so ordering does not excuse the miss.
2. `ent-042` "OpenAI-NVIDIA $100 billion investment partnership" ↔ `ent-054` "OpenAI-NVIDIA partnership announcement September 2025" — name-variant duplicate; `ent-042`'s alias "OpenAI NVIDIA partnership announcement" is a near-match (prefix) of `ent-054`'s name but not exact, and no embedding-similarity dedup fired.

By contrast the dedup DID catch 3 exact-name within-run repeats (IBM-HashiCorp, Pete Hegseth, H200) plus 1 alias-match link to the existing store (Manhattan Project → `ent-002`). So the gap is specifically **name-vs-alias and near-variant comparison within a run** — pipeline defect, routed to PowerShell (t/1830-style child of t/1797). Duplicates are curation-correctable via the designed merge/redirect path; not a data-integrity hazard of the batch-#1 class.

## Gate recall (AC 6) — first measurement, now that `dropped[]` persists

One below-gate drop: "Self-correcting search" (artifact, 0.45). Reviewed: the name denotes a generic technique — a **universal**, exactly what the typology excludes — so the drop is a true negative and the confidence gate did its job. **No below-gate proposal should have passed; nothing here argues for moving the 0.6 threshold** (and n=1 could not support a move anyway). Explicitly: this is a "drops occurred and were correct" result, not a "no drops" vacuous pass.

## Verdict

**Phase-1 exit gate: PASS (recommended).** All three t/1830 fixes confirmed in a live run; extraction quality holds (0.976 entity-level precision, zero hallucination, zero excluded-class leakage, correct gate behavior); t/1834 regression clean. One new pipeline defect (within-run name/alias dedup miss) routed to PowerShell — curation-correctable, non-blocking for Phase-2 filing in my judgment; TL ratifies.

Register updated in this commit (batch-#2 measurement appended to the entity-gate row; both rows stay **stipulated** — cumulative 77/78 with a single type-boundary error still gives no confidence-vs-correctness curve to tune against, and the linking-cosine row gains only n=1 alias-match evidence).
