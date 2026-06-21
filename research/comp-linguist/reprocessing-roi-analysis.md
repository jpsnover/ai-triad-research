# Reprocessing ROI Analysis

**Question:** We have substantially improved document ingestion quality and increased the taxonomy it works against. What would get better if we reprocessed all existing content?

**Date:** 2026-06-21

---

## What Would Improve

### 1. Source Attribution Coverage

Nodes created through debates (83 recently enriched, plus others added over time) have no `source_refs` tying them back to original documents. Reprocessing would discover that existing papers already discuss these topics, closing the attribution gap backward. This is the highest-value improvement — it connects debate-derived knowledge back to the evidentiary base.

### 2. Extraction Recall

The taxonomy is substantially larger now. The extraction pipeline maps extracted claims against existing nodes. With more nodes to match against, it will recognize claims it previously dropped as "no matching concept" — especially the nuanced regulatory, accountability, and cross-cutting nodes that emerged from recent debates.

### 3. Edge Density

Cross-POV tension edges and SUPPORTS relationships are easier to discover when both endpoints already exist in the taxonomy. First-pass ingestion often misses edges because the target node hadn't been created yet. Reprocessing with the full graph in place would surface relationships that were invisible on the first pass.

## What Would NOT Improve

**Enrichment fields** (attribution_text, synthetic_phrases, epistemic_type, etc.) come from the enrichment pipeline, not document ingestion. The batch enrichment run already covers the debate-modified nodes. Reprocessing documents would not regenerate these fields.

## What Could Regress If Not Careful

**Duplicate nodes** — if the pipeline creates nodes rather than just mapping to existing ones, near-duplicates of nodes that were manually refined through debate reflections would appear. The consolidation and dedup logic would need to handle this, or the pipeline should run in match-only mode.

## Recommendation

The highest-value reprocessing target is a **source-ref backfill only** — run extraction against the expanded taxonomy in match-only mode (no new node creation), purely to discover which existing documents support which newer nodes. This captures benefits 1 and 3 (attribution coverage and edge density) without the duplication risk.

A full reprocessing pass (with node creation enabled) should only be considered if the extraction prompts have changed enough to justify it, and would require a dedup pass afterward.
