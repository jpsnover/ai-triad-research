# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Sync-SyntheticCorpus {
    <#
    .SYNOPSIS
        Reports corpus health: stale, orphaned, and missing entries.
    .DESCRIPTION
        Dry-run by default — reports status without modifying anything.
        With -Fix, triggers Update-SyntheticCorpus for affected nodes.
    .PARAMETER CorpusPath
        Path to synthetic corpus directory. Defaults to taxonomy/Origin/synthetic/.
    .PARAMETER Fix
        Actually fix detected issues (calls Update-SyntheticCorpus).
    .EXAMPLE
        Sync-SyntheticCorpus
        # Report only.
    .EXAMPLE
        Sync-SyntheticCorpus -Fix
        # Report and fix.
    .LINK
        Show-AITriadHelp
    .LINK
        New-SyntheticCorpus
    .LINK
        Update-SyntheticCorpus
    .LINK
        Export-SyntheticEmbeddings
    .LINK
        Compare-EmbeddingModel
    .LINK
        Test-RerankerBaseline
    #>
    [CmdletBinding()]
    param(
        [string]$CorpusPath,
        [switch]$Fix
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $CorpusScript = Join-Path $script:RepoRoot 'scripts/generate_corpus.py'
    $TaxDir = Get-TaxonomyDir
    if (-not $CorpusPath) { $CorpusPath = Join-Path $TaxDir 'synthetic' }

    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    Write-Host "`nSynthetic Corpus Health Check" -ForegroundColor Cyan
    Write-Host "  Path: $CorpusPath" -ForegroundColor DarkGray

    if (-not (Test-Path $CorpusPath)) {
        Write-Host "  Corpus directory does not exist — no corpus generated yet." -ForegroundColor Yellow
        return
    }

    # ── Get current description hashes ──────────────────────────────────
    $PrevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $HashOutput = & $PythonCmd $CorpusScript get-hashes --taxonomy-dir $TaxDir 2>$null }
    finally { $ErrorActionPreference = $PrevEAP }

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not compute description hashes (generate_corpus.py failed)."
        return
    }

    $CurrentHashes = ($HashOutput -join '') | ConvertFrom-Json -AsHashtable
    $TotalNodes = $CurrentHashes.Count

    # ── Scan corpus files ───────────────────────────────────────────────
    $Report = @{
        Stale     = [System.Collections.Generic.List[string]]::new()
        Orphaned  = [System.Collections.Generic.List[string]]::new()
        Missing   = [System.Collections.Generic.List[string]]::new()
        Healthy   = 0
        TotalEntries = 0
    }

    $CorpusNodeIds = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($P in @('acc', 'saf', 'skp')) {
        $FilePath = Join-Path $CorpusPath "corpus_$P.json"
        if (-not (Test-Path $FilePath)) {
            foreach ($Key in $CurrentHashes.Keys) {
                if ($Key.StartsWith("$P-")) { $Report.Missing.Add($Key) }
            }
            continue
        }

        $Corpus = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
        $Entries = @($Corpus.entries)
        $Report.TotalEntries += $Entries.Count

        $NodeEntries = @{}
        foreach ($Entry in $Entries) {
            $Nid = $Entry.node_id
            [void]$CorpusNodeIds.Add($Nid)
            if (-not $NodeEntries.ContainsKey($Nid)) { $NodeEntries[$Nid] = @() }
            $NodeEntries[$Nid] += $Entry
        }

        foreach ($Nid in $NodeEntries.Keys) {
            if (-not $CurrentHashes.ContainsKey($Nid)) {
                $Report.Orphaned.Add($Nid)
            }
            else {
                $IsStale = $false
                foreach ($Entry in $NodeEntries[$Nid]) {
                    if ($Entry.PSObject.Properties['description_hash'] -and $Entry.description_hash -ne $CurrentHashes[$Nid]) {
                        $IsStale = $true
                        break
                    }
                }
                if ($IsStale) { $Report.Stale.Add($Nid) } else { $Report.Healthy++ }
            }
        }

        foreach ($Key in $CurrentHashes.Keys) {
            if ($Key.StartsWith("$P-") -and -not $CorpusNodeIds.Contains($Key)) {
                $Report.Missing.Add($Key)
            }
        }
    }

    # ── Display report ──────────────────────────────────────────────────
    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan
    Write-Host " CORPUS HEALTH REPORT" -ForegroundColor Cyan
    Write-Host "$('═' * 60)" -ForegroundColor Cyan
    Write-Host "  Taxonomy nodes:   $TotalNodes"
    Write-Host "  Corpus entries:   $($Report.TotalEntries)"
    Write-Host "  Nodes in corpus:  $($CorpusNodeIds.Count)"
    Write-Host ""
    Write-Host "  Healthy:          $($Report.Healthy)" -ForegroundColor Green
    Write-Host "  Stale:            $($Report.Stale.Count)" -ForegroundColor $(if ($Report.Stale.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "  Orphaned:         $($Report.Orphaned.Count)" -ForegroundColor $(if ($Report.Orphaned.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "  Missing:          $($Report.Missing.Count)" -ForegroundColor $(if ($Report.Missing.Count -gt 0) { 'Yellow' } else { 'Green' })

    $Issues = $Report.Stale.Count + $Report.Orphaned.Count + $Report.Missing.Count
    if ($Issues -eq 0) {
        Write-Host "`n  Corpus is fully synchronized." -ForegroundColor Green
    }
    elseif (-not $Fix) {
        Write-Host "`n  $Issues issue(s) found. Run with -Fix to resolve." -ForegroundColor Yellow
    }

    if ($Report.Stale.Count -gt 0 -and $Report.Stale.Count -le 20) {
        Write-Host "  Stale: $($Report.Stale -join ', ')" -ForegroundColor DarkGray
    }
    if ($Report.Orphaned.Count -gt 0 -and $Report.Orphaned.Count -le 20) {
        Write-Host "  Orphaned: $($Report.Orphaned -join ', ')" -ForegroundColor DarkGray
    }
    Write-Host ""

    # ── Fix if requested ────────────────────────────────────────────────
    if ($Fix -and $Issues -gt 0) {
        Update-SyntheticCorpus
    }

    return [PSCustomObject]@{
        Healthy      = $Report.Healthy
        Stale        = $Report.Stale.Count
        Orphaned     = $Report.Orphaned.Count
        Missing      = $Report.Missing.Count
        TotalEntries = $Report.TotalEntries
    }
}
