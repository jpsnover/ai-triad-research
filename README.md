# AI Triad Research Repository

**Status:** Private (→ Public after v1.0 release)
**Fellowship:** Berkman Klein Center, 2026
**Blueprint version:** 1.0.0

## Purpose
This repository is the source-of-truth for the AI Triad research project.
It contains source documents, conceptual taxonomies, AI-generated POV summaries,
and a living factual-conflict log.

## Directory Layout
\\\
taxonomy/           Conceptual taxonomy (one file per POV camp)
sources/            Ingested source documents (raw + Markdown snapshot + metadata)
summaries/          AI-generated POV summaries (keyed by doc-id)
conflicts/          Living log of disputed factual claims (keyed by claim-id)
rolodex-index/      Public-safe person IDs (no PII; full data in private rolodex repo)
poviewer/           POViewer application code (TBD)
scripts/            Ingestion, batch-summarize, audit scripts
.github/workflows/  GitHub Actions (batch reprocess on taxonomy version bump)
\\\

## Quick Start
\\\ash
# Ingest a URL
python scripts/ingest.py --url https://example.com/article --pov accelerationist

# Ingest everything in sources/_inbox/
python scripts/ingest.py --inbox

# Manually trigger batch reprocess (normally run by GitHub Actions)
python scripts/batch_summarize.py
\\\

## Taxonomy Version
Current: **\0.0.0.1**
See \TAXONOMY_VERSION\ for the current version string.
To bump: edit \	axonomy/*.json\, update \TAXONOMY_VERSION\, open a PR.

## Private-to-Public Checklist
- [ ] Run \python scripts/audit_pii.py\ — zero findings required
- [ ] Review all \conflicts/*.json\ human_notes for inadvertent PII
- [ ] Tag last private commit: \git tag v0-private-archive\
- [ ] Flip repo visibility in GitHub Settings
