# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchNearDuplicateLabelCount {
    <#
    .SYNOPSIS
        Counts near-duplicate key-point label pairs within each successful summary, for
        the extraction-metrics line (parameter #12; t/3910).
    .DESCRIPTION
        A pair is a near-duplicate when the Jaccard similarity of its lowercase word sets
        exceeds 0.6. Pairs are only compared within one summary, across all three camps.
        A summary that is missing or unreadable contributes 0.

        KNOWN LIMITATION (pinned by Invoke-BatchSummary.Characterization.Tests.ps1): real
        key_points carry `point`, not `label`. Under StrictMode the `$_.label` read throws,
        the empty catch swallows it, and that summary contributes 0 — so on real data this
        count is always 0. Kept as-is by the pure-refactor rule; fixing it changes the metric.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [AllowEmptyCollection()][object[]]$Succeeded = @(),
        [Parameter(Mandatory)][string]$SummariesDir
    )

    $DupCandidates = 0
    foreach ($Res in $Succeeded) {
        $SumPath = Join-Path $SummariesDir "$($Res.DocId).json"
        if (-not (Test-Path $SumPath)) { continue }
        try {
            $Sum = Get-Content -Raw $SumPath | ConvertFrom-Json
            $AllLabels = @()
            foreach ($Camp in @('accelerationist','safetyist','skeptic')) {
                $AllLabels += @(Get-BatchCampKeyPoint -Summary $Sum -Camp $Camp | ForEach-Object { $_.label ?? $_.point ?? '' })
            }
            # Check for near-duplicate labels (Jaccard > 0.6)
            for ($i = 0; $i -lt $AllLabels.Count; $i++) {
                for ($j = $i + 1; $j -lt $AllLabels.Count; $j++) {
                    $wa = @($AllLabels[$i].ToLower() -split '\s+')
                    $wb = @($AllLabels[$j].ToLower() -split '\s+')
                    $shared = @($wa | Where-Object { $wb -contains $_ }).Count
                    $union = ($wa + $wb | Select-Object -Unique).Count
                    if ($union -gt 0 -and ($shared / $union) -gt 0.6) { $DupCandidates++ }
                }
            }
        } catch {}
    }
    return $DupCandidates
}
