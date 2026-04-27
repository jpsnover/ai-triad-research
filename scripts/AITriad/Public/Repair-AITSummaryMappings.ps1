# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Backfills null and stale taxonomy_node_id values in summary key points
    using embedding cosine similarity against the current taxonomy.
.DESCRIPTION
    Scans all summary files for key points where taxonomy_node_id is null
    (never mapped) or points to a node that no longer exists (stale). Uses
    the all-MiniLM-L6-v2 embedding model to find the best-matching taxonomy
    node for each key point's text.

    Optionally re-evaluates existing mappings to redistribute references
    away from gravity-well nodes toward more specific matches.

    Does NOT re-run the full LLM pipeline — only fixes the node pointer.
.EXAMPLE
    Repair-AITSummaryMappings -DryRun
    # Preview what would change without modifying files
.EXAMPLE
    Repair-AITSummaryMappings
    # Fix null and stale mappings (default threshold 0.35)
.EXAMPLE
    Repair-AITSummaryMappings -ReEvaluate -Margin 0.10
    # Also reassign existing mappings where a better match exists (10%+ improvement)
.EXAMPLE
    Repair-AITSummaryMappings -UpdateEmbeddings
    # Regenerate embeddings first, then backfill
#>
function Repair-AITSummaryMappings {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [ValidateRange(0.2, 0.8)]
        [double]$Threshold = 0.35,

        [Parameter()]
        [switch]$ReEvaluate,

        [Parameter()]
        [ValidateRange(0.01, 0.5)]
        [double]$Margin = 0.08,

        [Parameter()]
        [switch]$UpdateEmbeddings
    )

    Set-StrictMode -Version Latest

    $RepoRoot = Get-CodeRoot
    $BackfillScript = Join-Path $RepoRoot 'scripts' 'backfill_taxonomy_mappings.py'
    $EmbedScript = Join-Path $RepoRoot 'scripts' 'embed_taxonomy.py'

    if (-not (Test-Path $BackfillScript)) {
        throw "Backfill script not found at: $BackfillScript"
    }

    # Check Python
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) { $Python = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $Python) {
        throw "Python is required. Install Python 3.10+ with sentence-transformers: pip install sentence-transformers"
    }

    # Optionally regenerate embeddings
    if ($UpdateEmbeddings) {
        Write-Host "Regenerating embeddings..." -ForegroundColor Yellow
        $EmbResult = & $Python.Source $EmbedScript generate 2>&1
        foreach ($Line in $EmbResult) { Write-Host "  $Line" -ForegroundColor DarkGray }
        Write-Host ""
    }

    # Build arguments
    $PyArgs = @($BackfillScript)
    $PyArgs += "--threshold"
    $PyArgs += $Threshold.ToString()

    if ($DryRun) { $PyArgs += "--dry-run" }

    if ($ReEvaluate) {
        $PyArgs += "--re-evaluate"
        $PyArgs += "--re-evaluate-margin"
        $PyArgs += $Margin.ToString()
    }

    $Action = if ($DryRun) { "Preview backfill" } else { "Backfill summary mappings" }
    if (-not $PSCmdlet.ShouldProcess("all summaries", $Action)) { return }

    # Run
    Write-Host "Running backfill..." -ForegroundColor Yellow
    $StdOut = [System.Collections.Generic.List[string]]::new()

    $Psi = [System.Diagnostics.ProcessStartInfo]::new()
    $Psi.FileName = $Python.Source
    $Psi.Arguments = ($PyArgs | ForEach-Object { "`"$_`"" }) -join ' '
    $Psi.WorkingDirectory = $RepoRoot
    $Psi.RedirectStandardOutput = $true
    $Psi.RedirectStandardError = $true
    $Psi.UseShellExecute = $false
    $Psi.CreateNoWindow = $true

    try {
        $Proc = [System.Diagnostics.Process]::Start($Psi)
    } catch {
        throw "Failed to start backfill process: $_"
    }

    while (-not $Proc.StandardError.EndOfStream) {
        $Line = $Proc.StandardError.ReadLine()
        if ($Line) { Write-Host $Line -ForegroundColor DarkGray }
    }

    $StdOutText = $Proc.StandardOutput.ReadToEnd()
    if (-not $Proc.WaitForExit(600000)) {
        try { $Proc.Kill() } catch { }
        throw "Backfill timed out after 10 minutes."
    }

    if ($StdOutText) { $StdOut.Add($StdOutText) }

    if ($DryRun -and $StdOutText) {
        try {
            $Report = $StdOutText | ConvertFrom-Json
            Write-Host "`nDry run report:" -ForegroundColor Cyan
            Write-Host "  Null → mapped:    $($Report.null_fixed)" -ForegroundColor Green
            Write-Host "  Stale → remapped: $($Report.stale_fixed)" -ForegroundColor Green
            Write-Host "  Re-evaluated:     $($Report.reassigned)" -ForegroundColor Yellow
            Write-Host "  No match found:   $($Report.no_match)" -ForegroundColor DarkGray
            return $Report
        } catch {
            return $StdOutText
        }
    }

    Write-Host "`nBackfill complete." -ForegroundColor Green
}
