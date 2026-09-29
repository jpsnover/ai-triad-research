# Genuine-conflict gate, demotion-set manifest (t/3633)

**Owner:** Computational Linguist (conflict definition + this manifest). **Gate implementer:** PowerShell (`scripts/consolidate_conflicts.py`).

The CL-owned prerequisite for the t/3633 genuine-conflict gate: the **must-not-reappear list** the gate keys against so a full `consolidate_conflicts.py` regen never re-introduces the 432 standalone facts t/3350 surgically demoted (data-of-record `0f38b2e7`).

## Why a manifest (not auto-classification)

The revised design (t/3633#2) is deliberately conservative. Auto opposition-detection is NOT the gate: t/3339#18 measured the numeric contradiction detector at **0.000 precision** and the deployed detector at **0.065** (it fires on different quantities, rounding, subsets, not genuine opposition). So instead of re-classifying, the gate keys demotions to this committed manifest of the already-adjudicated 432.

## Files

- `build_demotion_manifest.py`, extracts the demoted set from the live `conflicts.json` (entries with `status == "demoted"` + `claim_type == "non_conflict"` + `demotion.reason == "standalone_fact"`) and writes `demotion-manifest.json`. `--verify` re-derives and diffs vs the committed manifest (non-zero exit on drift, CI-friendly).
- `demotion-manifest.json`, **432 entries**, each `{claim_id, claim_label, assertion_sigs}`. content_hash keys the whole set.

## How the gate consumes it (PowerShell impl)

In `consolidate_conflicts.py`, before emitting a candidate as a conflict: if the candidate's `claim_id` **OR** any normalized instance-assertion signature matches an entry in `demotion-manifest.json`, emit it **demoted** (not a conflict), and log the demotion (count + provenance `"in t/3350 manifest"`) per the fallback-path logging rule. This satisfies revised ACs 1–3. AC4 (no multi-instance conflict already in the corpus is dropped) holds because the manifest contains only the 432 single-instance standalone facts.

- `claim_id` is content-derived (e.g. `conflict-36-out-of-38-gene-synthesis-providers-...`), so a regen from the same source should re-mint the same id, the primary key. `assertion_sigs` (lowercased, whitespace-collapsed, trailing-punctuation-stripped) is the fallback if a regen mints a different id.
- **Refresh discipline:** if the demoted set legitimately changes (a new demotion batch), re-run the builder and commit the updated manifest; `--verify` in CI catches silent drift between the live set and the committed manifest.

## Status

Manifest + builder are the CL prerequisite, done. The gate itself (PowerShell, `consolidate_conflicts.py`) is deferred/low-pri per t/3633 (a full regen is rare/risky post-fork-B; the surgical demotion holds in practice), build it when a regen is next contemplated. Not a schema change; gates nothing until then.
