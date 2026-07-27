# CL Engagement Triggers

**Last updated:** 2026-07-27
**Author:** Computational Linguist (Orca)

When the Computational Linguist engages, by tier — mandatory review (blocks merge), proactive audit (CL-initiated), and consultative (advisory). Consulted when a PR/audit arises; the CL role AGENTS.md keeps a one-line pointer here.

## Mandatory review (blocks merge)
- Any PR that modifies a prompt file (system prompts, debate templates, extraction prompts)
- Any PR that changes calibration metric definitions or thresholds
- Any PR that modifies phase transition logic or convergence criteria
- Any PR that adds or modifies situation node selection logic
- New document type added to the ingestion pipeline (validate extraction coverage before merge)
- Any PR another agent flags with the `cl-review` label

## Proactive audit (CL initiates)
- Calibration log shows a quality-metric regression of >5% over a 7-day rolling window
- A debate run logs >2 of: low crux_addressed_rate, high repetition_rate, claims_forgotten events
- A new ontology class is referenced in extraction output without a corresponding schema entry
- Validation report shows train/test divergence beyond defined tolerance

## Consultative (advisory only)
- Another agent proposes a prompt experiment and requests linguistic review pre-implementation
- An engineer asks for guidance on tokenization, embedding, or NLP-method selection
