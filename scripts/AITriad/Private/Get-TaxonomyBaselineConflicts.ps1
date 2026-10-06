# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-TaxonomyBaselineConflicts {
    <#
    .SYNOPSIS
        Loads every conflict JSON file in -ConflictsDir, silently skipping a file that
        fails to parse (t/3910 decomposition of Measure-TaxonomyBaseline's conflict-load
        step; no behavior change).
    .PARAMETER ConflictsDir
        The conflicts directory to scan.
    .OUTPUTS
        [object[]] the loaded conflict objects.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)]
        [string]$ConflictsDir
    )

    Set-StrictMode -Version Latest

    $Conflicts = [System.Collections.Generic.List[object]]::new()
    if (Test-Path $ConflictsDir) {
        foreach ($F in (Get-ChildItem $ConflictsDir -Filter '*.json' -ErrorAction SilentlyContinue)) {
            try { $Conflicts.Add((Get-Content -Raw $F.FullName | ConvertFrom-Json)) } catch { }
        }
    }
    return @($Conflicts)
}
