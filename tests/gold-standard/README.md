# Gold-Standard Evaluation Set

Human-annotated ground truth for measuring extraction quality.

## Schema

Each `<doc-id>.gold.json` contains:

- `expected_key_points`: taxonomy node mappings the AI should find (node ID, category, POV, stance)
- `expected_factual_claims`: factual claims the AI should extract (summary + linked nodes)
- `expected_unmapped_concepts`: concepts not in the taxonomy that should be flagged

## Usage

```powershell
# Test a single document
Test-ExtractionQuality -DocId 'ai-safety-debate-2026'

# Test all annotated documents
Test-ExtractionQuality -All

# Get results for pipeline use
$r = Test-ExtractionQuality -All -PassThru
```

## Annotating a New Document

1. Copy `_template.gold.json` to `<doc-id>.gold.json`
2. Read the document's `sources/<doc-id>/snapshot.md`
3. Fill in expected key_points, factual_claims, and unmapped_concepts
4. Run `Test-ExtractionQuality -DocId <doc-id>` to compare against AI output
