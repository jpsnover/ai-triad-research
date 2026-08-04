# Talmudic Debate Experiment

These scripts run and inspect the source-grounded Talmudic moderator experiment. Run the commands below from the repository root:

```powershell
Set-Location D:\mygit\ai-triad-research
```

The Talmudic moderator is still a moderator, not a fourth debater. When source grounding is enabled, it selects at most one verified source card for a round and asks the next debater to identify both a relevant similarity and a limiting difference.

## Prerequisites

- PowerShell 7
- Git, Node.js, and `npx` on `PATH`
- An `OPENAI_API_KEY` with access to the model configured in `debate-talmudic-openai.json`
- Network access during corpus initialization and debate execution

The run script keeps its sparse taxonomy checkout inside `.local-data\ai-triad-data`. It does not write to the root of `D:\` or directly beneath `D:\mygit`.

## 1. Initialize the source corpus

Run this once before the first source-grounded debate:

```powershell
.\scripts\TalmudicDebate\Initialize-TalmudicCorpus.ps1
```

The initializer retrieves the 12 configured Mishnah and Babylonian Talmud references from exact named Sefaria editions. It verifies edition names and licenses, then records the Hebrew source, English translation, attribution, retrieval date, URL, and checksum.

The generated corpus is stored locally at:

```text
.local-data\talmudic-corpus\pilot-v1.json
```

The downloaded text is ignored by Git. Some selected English editions are CC-BY-NC and are intended only for this local, noncommercial experiment.

If the corpus already exists, the initializer stops instead of overwriting it. Rebuild it deliberately with:

```powershell
.\scripts\TalmudicDebate\Initialize-TalmudicCorpus.ps1 -Force
```

Use `-Force` when refreshing named editions or verifying that upstream licenses have not changed. A changed, missing, or unknown license causes an actionable error.

## 2. Run a debate

The default source-grounded configuration is `debate-talmudic-openai.json`:

```powershell
.\scripts\TalmudicDebate\Run-TalmudicDebate.ps1
```

The script:

1. Validates the configuration and local corpus.
2. Creates or updates the repository-local sparse taxonomy checkout.
3. Sets `AI_TRIAD_DATA_ROOT` for the current process.
4. Prompts securely for `OPENAI_API_KEY` if it is not already set.
5. Prints whether the run is `method-only` or `source-grounded`.
6. Runs the debate CLI and writes artifacts beneath `debates\`.

For unattended execution, set the key before running and use `-NonInteractive`:

```powershell
$env:OPENAI_API_KEY = Read-Host 'OPENAI_API_KEY' -AsSecureString |
    ConvertFrom-SecureString -AsPlainText

.\scripts\TalmudicDebate\Run-TalmudicDebate.ps1 -NonInteractive
```

To use another configuration:

```powershell
.\scripts\TalmudicDebate\Run-TalmudicDebate.ps1 `
    -ConfigPath .\my-talmudic-debate.json
```

Source grounding is controlled by this optional configuration block:

```json
{
  "moderatorMode": "talmudic",
  "talmudicReferences": {
    "enabled": true,
    "corpusPath": "./.local-data/talmudic-corpus/pilot-v1.json",
    "maxCandidates": 3,
    "maxReferencesPerRound": 1,
    "minScore": 0.30
  }
}
```

Set `talmudicReferences.enabled` to `false` for method-only Talmudic moderation. If it is `true`, a missing or invalid corpus is an error; the engine never silently falls back.

## 3. Review what happened

Review the newest debate log:

```powershell
.\scripts\TalmudicDebate\Review-TalmudicDebate.ps1
```

Review a particular artifact:

```powershell
.\scripts\TalmudicDebate\Review-TalmudicDebate.ps1 `
    -Path .\debates\<slug>-debate.json
```

The reviewer shows:

- The moderator's focused crux and disagreement classification
- Retrieval candidates, winning score, selected source, and usage type
- Edition, license, canonical citation, excerpt, and checksum integrity
- Whether the source card was visible in the transcript
- The next debater's `accepts`, `rejects`, `distinguishes`, or `limits` stance
- The relevant similarity and limiting difference supplied by that debater
- No-match rounds, validation scores, unresolved cruxes, and integrity warnings
- Duplicate argument-node IDs that could make claim references ambiguous

For machine-readable review output:

```powershell
.\scripts\TalmudicDebate\Review-TalmudicDebate.ps1 -AsJson
```

To include the raw moderator response:

```powershell
.\scripts\TalmudicDebate\Review-TalmudicDebate.ps1 `
    -IncludeRawModeratorResponse
```

In the debate JSON, the main evidence-chain fields are:

```text
dialectical_diagnostics[].reference_selection
transcript[].metadata.moderator_trace
transcript[].metadata.talmudic_reference_response
```

## 4. Run matched comparisons

A single debate can demonstrate that the feature executed, but it cannot show that references caused a behavioral difference. Run repeated matched method-only/source-grounded pairs:

```powershell
.\scripts\TalmudicDebate\Invoke-TalmudicReferenceExperiment.ps1 -Pairs 3
```

Each pair uses the same topic, model, rounds, response length, and temperature:

1. Talmudic moderation with references disabled.
2. Talmudic moderation with references enabled.

Experiment configurations and the pair manifest are stored beneath:

```text
.local-data\talmudic-experiments\<experiment-id>\
```

The runner prints the control and sourced artifact paths. Compare a pair with:

```powershell
.\scripts\TalmudicDebate\Review-TalmudicDebate.ps1 `
    -Path <source-grounded-debate.json> `
    -BaselinePath <method-only-debate.json>
```

The comparison reports reference-specific engagement, stance, limiting differences, no-match rounds, citation integrity, and unresolved-crux changes. Treat repeated pairs as evidence, not deterministic causal proof.

Preview the experiment operation without running model calls:

```powershell
.\scripts\TalmudicDebate\Invoke-TalmudicReferenceExperiment.ps1 `
    -Pairs 3 `
    -WhatIf
```

## Typical workflow

```powershell
Set-Location D:\mygit\ai-triad-research

# First time only
.\scripts\TalmudicDebate\Initialize-TalmudicCorpus.ps1

# Run and inspect one source-grounded debate
.\scripts\TalmudicDebate\Run-TalmudicDebate.ps1
.\scripts\TalmudicDebate\Review-TalmudicDebate.ps1

# Gather stronger comparative evidence
.\scripts\TalmudicDebate\Invoke-TalmudicReferenceExperiment.ps1 -Pairs 3
```

## Troubleshooting

- **Corpus already exists:** Keep it, or use `Initialize-TalmudicCorpus.ps1 -Force` for a deliberate refresh.
- **Corpus missing or invalid:** Run the initializer and confirm `corpusPath` points beneath `.local-data\talmudic-corpus`.
- **License changed:** Do not bypass the error. Review the named Sefaria edition and update the tracked manifest only after confirming reuse terms.
- **`OPENAI_API_KEY` missing:** Run interactively, or set the process environment variable before using `-NonInteractive`.
- **No reference selected:** The debate continues and records a no-match reason when every unused candidate scores below `minScore`.
- **Invalid engagement:** Review the response warnings for a missing stance, similarity, limiting difference, mismatched card ID, or language claiming that “the Talmud” directly dictates modern policy.
- **Need the raw evidence:** Use reviewer `-AsJson` and inspect the three evidence-chain fields listed above.

