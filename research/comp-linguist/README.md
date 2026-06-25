# Computational Linguist Research Directory

Research artifacts for the Computational Linguist role — prompt experiments, calibration analysis, embedding evaluations, ontology audits, and quality metrics.

## Directory Structure

```
research/comp-linguist/
├── analyses/       Completed analysis reports and findings
├── configs/        Experiment configuration files
├── designs/        Design documents and proposals
├── docs/           Experiment protocols, methodology docs, specs
├── results/        Structured experiment output (JSON + markdown)
├── reviews/        Prompt reviews, audit reports, paper reviews
├── scripts/        Reusable experiment scripts (.py, .ps1, .ts)
├── _*.py           Ad-hoc investigation scripts (ephemeral, not reusable)
├── _*_results.json Experiment result data
├── _*_cache.json   LLM response caches (avoid re-running expensive calls)
└── *.json          Golden sets, corpora, training data
```

## Conventions

- **`_` prefix** = ephemeral scratch file. May reference absolute paths, may be abandoned. Not polished for reuse. Acceptable to accumulate during active research; prune periodically.
- **No prefix** in subdirectories = durable artifact. Should have clear naming, be self-documenting.
- **Scripts** use absolute paths for data references (enables running from any CWD). When paths change, update the script — don't rely on relative paths.
- **Caches** (`_*_cache.json`) store LLM responses to avoid re-running expensive API calls. Safe to delete; will be regenerated on next run.
- **Golden sets** (`_golden_test_set.json`, `_t534_test_set.json`) are evaluation baselines. Do not delete without archiving.

## Key Artifacts

| File | Purpose | Ticket |
|------|---------|--------|
| `_golden_test_set.json` | 664 debate claims with embeddings, attribution, BDI | t/536 |
| `weight_grid_results.json` | Embedding weight optimization results | t/507 |
| `training_corpus.json` | Contrastive fine-tuning corpus (49MB) | t/552 |
| `debate_claims_corpus.json` | Full debate claims corpus | t/536 |
| `dolce_audit_results.json` | DOLCE ontology compliance audit | — |
