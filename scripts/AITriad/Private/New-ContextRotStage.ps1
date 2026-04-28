# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Context-rot instrumentation helper.
# Builds a stage measurement matching the ContextRotStage TypeScript interface.
# Dot-sourced by AITriad.psm1 — do NOT export.

function New-ContextRotStage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Stage,
        [Parameter(Mandatory)][string]$InUnits,
        [Parameter(Mandatory)][double]$InCount,
        [Parameter(Mandatory)][string]$OutUnits,
        [Parameter(Mandatory)][double]$OutCount,
        [hashtable]$Flags = @{}
    )
    $Ratio = if ($InCount -gt 0) { [Math]::Round($OutCount / $InCount, 4) } else { 0 }
    [ordered]@{
        stage    = $Stage
        in_units = $InUnits
        in_count = $InCount
        out_units = $OutUnits
        out_count = $OutCount
        ratio    = $Ratio
        flags    = [ordered]@{} + $Flags
    }
}

function New-ContextRotMetrics {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Pipeline,
        [Parameter(Mandatory)][string]$DocId,
        [Parameter(Mandatory)][array]$Stages
    )
    $CumulativeRetention = 1.0
    foreach ($s in $Stages) {
        if ($s.ratio -gt 0 -and $s.ratio -le 1) {
            $CumulativeRetention *= $s.ratio
        }
    }
    [ordered]@{
        schema_version       = 1
        pipeline             = $Pipeline
        doc_id               = $DocId
        measured_at          = (Get-Date -Format 'o')
        stages               = @($Stages)
        cumulative_retention = [Math]::Round($CumulativeRetention, 4)
    }
}
