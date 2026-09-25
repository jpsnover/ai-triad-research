# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Single source of truth for AITriad's mutable module ($script:) state.
.DESCRIPTION
    Called once at module load (first call: eager-loads the taxonomy/policy corpus
    and captures a PRISTINE reference + hash of it) and again per test file to RESET
    state cheaply (t/3665). The expensive parts — defining 396 functions (~3s) and the
    one-time corpus load (~1.5s) — are NOT repeated on reset:

      - Cheap mutable scalars/caches → reset to their declared defaults (~0ms).
      - ai-models.json → re-read (small, fast); single source for AIModelConfig/ValidModelIds.
      - Taxonomy/policy corpus → on RESET, re-POINT `$script:TaxonomyData` /
        `TaxonomyFileTimestamps` / `PolicyRegistry` at the pristine reference captured on
        first load (~0ms). Every corpus write in the suite is a REASSIGNMENT, so re-pointing
        restores it. In-place mutation of the pristine object would defeat this silently —
        that is what the suite-end corpus hash-guard (Assert-AITriadCorpusPristine) catches.

    Production never calls this on reset; it runs exactly once at import, identical to the
    prior inline init. Only the test bootstrap invokes the reset path.
#>
function Initialize-AITriadRuntimeState {
    [CmdletBinding()]
    param()

    # ── Cheap mutable scalars / lazy caches → declared defaults ──────────────────
    $script:CachedEmbeddings           = $null
    $script:EmbeddingsTimestamp        = $null
    $script:CachedSyntheticVectors     = $null
    $script:SyntheticTimestamp         = $null
    $script:TaxonomyCacheLastCheck     = $null
    $script:PillarNodeIds              = $null
    $script:RetrievalConfidenceThreshold = 0.45
    $script:ExcludesVetoMargin         = 0.0

    # ── ai-models.json (small; re-read each time — single source) ────────────────
    $script:AIModelConfig = $null
    $script:ValidModelIds = @()
    $AIModelsPath = Join-Path $script:RepoRoot 'ai-models.json'
    if (-not (Test-Path $AIModelsPath)) { $AIModelsPath = Join-Path $script:ModuleRoot 'ai-models.json' }
    if (Test-Path $AIModelsPath) {
        try {
            $script:AIModelConfig = Get-Content -Raw -Path $AIModelsPath | ConvertFrom-Json
            $script:ValidModelIds = @($script:AIModelConfig.models | ForEach-Object { $_.id })
        }
        catch { Write-Warning "AI Models: failed to load ai-models.json — $($_.Exception.Message)" }
    }

    # ── Taxonomy + policy corpus: load once, then re-point to pristine ───────────
    if ($null -eq $script:_PristineTaxonomyData) {
        # FIRST call (module load): eager-load, then capture the pristine reference + hash.
        $script:TaxonomyData           = @{}
        $script:TaxonomyFileTimestamps = @{}
        $TaxonomyDir = Get-TaxonomyDir
        if (Test-Path $TaxonomyDir) {
            $script:_TaxSkipNames = @(
                'embeddings.json', 'edges.json', 'policy_actions.json', '_archived_edges.json',
                'lineage_categories.json', 'interpretation_embeddings.json',
                'source_evidence_index.json', 'similarity-cache.json'
            )
            foreach ($File in Get-ChildItem -Path $TaxonomyDir -Filter '*.json' -File) {
                $script:_TaxSkip = $File.Name -in $script:_TaxSkipNames
                if (-not $script:_TaxSkip) {
                    $script:_TaxSkip = $File.Name -like 'embeddings-*.json' -or $File.Name -like '*-embeddings.json'
                }
                if (-not $script:_TaxSkip) {
                    if ($File.Length -gt 10MB) {
                        Write-Warning "Taxonomy: skipping $($File.Name) — file is $([math]::Round($File.Length / 1MB, 1)) MB (likely corrupted, max 10 MB)."
                    } else {
                        try {
                            $Json = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
                            if (Test-IsPovTaxonomyData $Json) {
                                $PovName = $File.BaseName.ToLower()
                                $script:TaxonomyData[$PovName] = $Json
                                $script:TaxonomyFileTimestamps[$File.FullName] = $File.LastWriteTime
                            }
                        }
                        catch {
                            Write-Warning "Taxonomy: failed to load $($File.Name): $_ — this POV will be unavailable until the file is fixed."
                        }
                    }
                }
            }
        }
        if ($script:TaxonomyData.Count -eq 0) {
            Write-Warning "Taxonomy: no valid JSON files loaded from $TaxonomyDir — most commands will not work."
        }

        $script:PolicyRegistry = $null
        $RegistryFile = Join-Path $TaxonomyDir 'policy_actions.json'
        if (Test-Path $RegistryFile) {
            try { $script:PolicyRegistry = Get-Content -Raw -Path $RegistryFile | ConvertFrom-Json }
            catch { Write-Warning "Policy registry: failed to load — $($_.Exception.Message)" }
        }

        # Capture pristine references + a hash for the suite-end mutation guard (t/3665).
        $script:_PristineTaxonomyData      = $script:TaxonomyData
        $script:_PristineTaxonomyTimestamps = $script:TaxonomyFileTimestamps
        $script:_PristinePolicyRegistry    = $script:PolicyRegistry
        $script:_PristineCorpusHash        = Get-AITriadCorpusHash
    }
    else {
        # RESET call (per test file): re-point at pristine — ~0ms, no reload.
        $script:TaxonomyData           = $script:_PristineTaxonomyData
        $script:TaxonomyFileTimestamps = $script:_PristineTaxonomyTimestamps
        $script:PolicyRegistry         = $script:_PristinePolicyRegistry
    }
}

# Stable hash of the corpus, used to detect in-place mutation of the pristine objects
# (reference-restore cannot catch that — t/3665, TL condition). Order-independent over POVs.
function Get-AITriadCorpusHash {
    [CmdletBinding()]
    param()
    $sb = [System.Text.StringBuilder]::new()
    foreach ($pov in ($script:TaxonomyData.Keys | Sort-Object)) {
        [void]$sb.Append($pov).Append('=').Append(($script:TaxonomyData[$pov] | ConvertTo-Json -Depth 12 -Compress)).Append("`n")
    }
    [void]$sb.Append('policy=').Append(($script:PolicyRegistry | ConvertTo-Json -Depth 12 -Compress))
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

# Suite-end guard: fails if the pristine corpus was mutated in place during the run.
function Assert-AITriadCorpusPristine {
    [CmdletBinding()]
    param()
    $now = Get-AITriadCorpusHash
    if ($now -ne $script:_PristineCorpusHash) {
        throw (New-ActionableError -PassThru `
            -Goal 'Keep the taxonomy/policy corpus immutable across the test run (t/3665 reset integrity)' `
            -Problem 'The pristine corpus hash changed — a test mutated $script:TaxonomyData/$script:PolicyRegistry IN PLACE, which reference-restore cannot undo (it poisons every later reset).' `
            -Location 'AITriad / Assert-AITriadCorpusPristine' `
            -NextSteps @(
                'Find the test that mutates the corpus in place (e.g. $script:TaxonomyData[$pov].nodes += ...) rather than reassigning it',
                'Change it to reassign a fresh copy, or deep-copy the pristine capture in Initialize-AITriadRuntimeState'))
    }
}
