# Context-Rot Playbook

## What is Context Rot?

Context rot is measurable information loss at each stage of the AI Triad document processing pipeline. Every transformation — format conversion, chunking, RAG filtering, AI extraction, deduplication, truncation, and compression — discards some information. These losses compound: a 10% loss at three stages means 27% total loss, not 30%.

This matters because lost claims create blind spots in taxonomy coverage. A policy argument that falls in a chunk boundary or gets truncated from a debate may never surface as a taxonomy node, edge, or factual claim.

## Reading the Metrics

Every summary and debate session now includes a `context_rot` object with per-stage measurements. Each stage records:

- **in_count / out_count** — what went in and what came out
- **ratio** — retention (1.0 = no loss, 0.0 = total loss)
- **flags** — stage-specific counters (what exactly was lost)
- **cumulative_retention** — product of all stage ratios

### Summary Pipeline Stages

#### `chunking`
Splits large documents (>20K tokens) into chunks for per-chunk AI extraction.

- **in/out**: estimated tokens before vs. sum of chunk tokens
- **Key flags**: `chunk_count` — how many pieces the document was split into
- **Healthy**: ratio near 1.0, chunk_count 2-5
- **Concerning**: chunk_count > 8 (very long document, many boundary opportunities for loss)

#### `rag_filtering`
Selects the most relevant taxonomy nodes (from ~518 total) to include in the extraction prompt.

- **in/out**: total nodes available vs. selected nodes
- **Key flags**: `below_threshold_forced` (nodes pulled in below the similarity threshold to meet per-category minimums), `beliefs_selected`, `desires_selected`, `intentions_selected`
- **Healthy**: 30-80 nodes selected, all three BDI categories represented, below_threshold_forced < 5
- **Concerning**: < 20 nodes selected (poor embedding match), or one category has only 3 forced nodes
- **Action**: Check document pov_tags; consider `-FullTaxonomy` for unusual documents

#### `extraction`
AI extraction of key_points, factual_claims, and unmapped_concepts from the document.

- **in/out**: prompt character count vs. total items extracted
- **Key flags**: `null_node_rate` (fraction of key_points with no taxonomy mapping), `density_floor_hit` (extraction was below minimum density), `used_fire` (iterative extraction was used)
- **Healthy**: null_node_rate < 0.15, density_floor_hit = 0
- **Concerning**: null_node_rate > 0.30 (model cannot map points to taxonomy — taxonomy may lack nodes for this topic)
- **Red**: density_floor_hit = 1 after retries — document may be low-information or snapshot.md quality is poor

#### `merge_dedup`
Combines chunk-level extractions into a single summary, deduplicating overlapping points.

- **in/out**: total items across all chunks vs. items after dedup
- **Key flags**: `points_deduped`, `claims_deduped`, `concepts_deduped`, `used_embeddings` (1 = semantic dedup, 0 = string-prefix fallback)
- **Healthy**: dedup rate 10-30% (some overlap at chunk boundaries is normal)
- **Concerning**: dedup rate > 50% (chunks too similar — consider reducing OverlapTokens or increasing MaxChunkTokens)
- **Concerning**: dedup rate < 5% for multi-chunk docs (dedup may not be working)
- **Action**: Check if `used_embeddings = 0` — install local embedding model for better semantic dedup

#### `unmapped_resolution`
Fuzzy-matches unmapped concepts against the full taxonomy to recover missed mappings.

- **in/out**: unmapped concepts in vs. still-unmapped after resolution
- **Key flags**: `resolved_count`, `near_miss_count` (concepts with best score between 0.30 and threshold)
- **Healthy**: resolution_rate > 0.30
- **Informational**: near_miss_count > 3 — these concepts almost matched and may warrant new taxonomy nodes
- **Action**: Review near-misses manually with `Get-UnmappedConcepts`

### Debate Pipeline Stages

#### `document_truncation`
Hard limit on document length fed to the debate engine (default 50K characters).

- **in/out**: original document length vs. truncated length
- **Key flags**: `chars_truncated`, `sections_lost` (headings after the cut point), `truncation_limit`
- **Healthy**: chars_truncated = 0 (document fits)
- **Concerning**: sections_lost > 0 (content after a heading was dropped)
- **Action**: Run `Invoke-DebateAB` to test whether increasing the limit improves quality

#### `transcript_compression`
Summarizes older debate transcript entries when the transcript exceeds 12 entries.

- **in/out**: original transcript text length vs. compressed summary length
- **Key flags**: `entries_compressed`, `compression_ratio`, `window_size` (entries kept in full)
- **Healthy**: compression_ratio > 0.10 (summary retains >10% of original detail)
- **Concerning**: compression_ratio < 0.05 (very aggressive compression)
- **Note**: This stage may fire multiple times in long debates; each compression event is a separate stage entry

## Quick Reference Table

| Stage | Green | Yellow | Red |
|-------|-------|--------|-----|
| chunking chunk_count | 2-5 | 6-8 | > 8 |
| rag_filtering nodes | 30-80 | 20-30 | < 20 |
| extraction null_node_rate | < 0.15 | 0.15-0.30 | > 0.30 |
| extraction density_floor_hit | 0 | — | 1 |
| merge_dedup dedup_rate | 10-30% | 30-50% | > 50% |
| unmapped resolution_rate | > 0.30 | 0.10-0.30 | < 0.10 |
| truncation sections_lost | 0 | 1-2 | > 2 |
| compression ratio | > 0.10 | 0.05-0.10 | < 0.05 |
| **cumulative_retention** | **> 0.70** | **0.50-0.70** | **< 0.50** |

## Decision Procedures

### "My cumulative retention is below 0.50"

1. Open the summary JSON, find `context_rot.stages`
2. Sort by `ratio` ascending — the lowest ratio is your worst stage
3. Go to that stage's section above and follow the action steps
4. Re-run the summary: `Invoke-DocumentSummary -DocId <id> -Force`
5. Compare cumulative_retention before and after

### "My debate claim coverage is low"

1. Check `context_rot.stages` for `document_truncation`
2. If `sections_lost > 0`: the debate never saw those sections — run A/B with a higher limit
3. If `sections_lost = 0`: check `extraction_summary.acceptance_rate`
4. If acceptance rate is low: the AN may be saturated (check `extraction_summary.plateau_detected`)
5. If AN is still growing: more rounds may help

### "Should I change the truncation limit?"

1. Pick 3-5 documents that are larger than the current limit (50K chars)
2. Run on each: `Invoke-DebateAB -DocPath <path>`
3. Look at the comparison table. Focus on:
   - **Claim coverage %** — primary quality metric (higher = more of the source discussed)
   - **Taxonomy utilization %** — breadth of argument (higher = more taxonomy touched)
   - **Sections lost** — should drop to 0 with the higher limit
   - **Total AI time** — cost constraint (expect 30-50% increase with doubled limit)
4. If 3+ documents show improvement in claim coverage AND taxonomy utilization: change the default
5. If results are mixed or marginal: the cost increase is not justified

### "Unmapped concepts keep showing up for the same topics"

1. Run: `Get-UnmappedConcepts -Aggregate` across recent summaries
2. Group by `suggested_label` — recurring labels indicate genuine taxonomy gaps
3. For recurring labels with `near_miss_count > 0`: review the near-miss node
4. If the concept is genuinely new: create a taxonomy node via the Taxonomy Editor
5. After adding nodes, re-run summaries for affected documents

## Using A/B Data

### Running an A/B test

```powershell
# Single document
Invoke-DebateAB -DocPath ../sources/my-doc/snapshot.md

# Custom limits
Invoke-DebateAB -DocPath ../sources/my-doc/snapshot.md -LimitA 30000 -LimitB 80000

# Get structured data for aggregation
$Result = Invoke-DebateAB -DocPath ../sources/my-doc/snapshot.md -PassThru
```

### Aggregating across documents

```powershell
$Docs = @(
    '../sources/doc-a/snapshot.md',
    '../sources/doc-b/snapshot.md',
    '../sources/doc-c/snapshot.md'
)
$Results = foreach ($D in $Docs) {
    Invoke-DebateAB -DocPath $D -PassThru
}

# Average the deltas
$Metrics = $Results[0].metrics.Keys
foreach ($M in $Metrics) {
    $AvgDelta = ($Results | ForEach-Object { $_.metrics.$M.delta } | Measure-Object -Average).Average
    Write-Host "$M avg delta: $([Math]::Round($AvgDelta, 2))"
}
```

### What to compare

- **Primary**: claim_coverage %, taxonomy_utilization % — these measure argument quality
- **Secondary**: AN nodes, unique taxonomy nodes — these measure argument richness
- **Constraint**: total_ai_time_s — this is the cost you pay for better coverage
- **Diagnostic**: chars_truncated, sections_lost — confirms the mechanical change worked

### Decision threshold

There is no statistical test here — this is a structured qualitative comparison for a solo researcher. The rule of thumb:

- If 3+ documents show consistent improvement in primary metrics: the change is worth making
- If results are mixed (some better, some worse): the parameter change interacts with document characteristics — consider making it per-document rather than a global default
- If all documents show negligible difference: the current limit is fine; save the API cost

### Cost awareness

Each A/B run executes two full debates. With Gemini 2.5 Flash at ~3 minutes per debate:
- Single A/B: ~6 minutes, ~2x normal cost
- 5-document A/B battery: ~30 minutes, ~10x normal cost

Plan accordingly. Run the battery on representative documents, not the entire corpus.
