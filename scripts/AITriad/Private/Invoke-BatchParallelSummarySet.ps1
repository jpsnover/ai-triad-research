# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-BatchParallelSummarySet {
    <#
    .SYNOPSIS
        Invoke-BatchSummary's parallel path (t/3910, t/1728, t/1774): one runspace per doc,
        up to -MaxConcurrent at a time, each result added to -Results.
    .DESCRIPTION
        Each runspace imports the full module, so every public and private function,
        script-scope variable ($script:TaxonomyData, $script:RepoRoot,
        $script:CachedEmbeddings, ...) and prompt cache is available. The earlier manual
        function capture broke whenever new functions or variables were added (RAG, CHESS,
        FIRE, QBAF). Requires PowerShell 7; Invoke-BatchSummary clamps to 1 on 5.1.
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][System.Collections.Generic.List[hashtable]]$Doc,
        [Parameter(Mandatory)][hashtable]$SharedParams,
        [Parameter(Mandatory)][System.Collections.Concurrent.ConcurrentBag[object]]$Results,
        [Parameter(Mandatory)][int]$MaxConcurrent
    )

    Write-Info "Running $MaxConcurrent parallel workers"

    $ModulePath = Join-Path $script:ModuleRoot 'AITriad.psm1'

    $Doc | ForEach-Object -Parallel {
        Import-Module $using:ModulePath -Force
        # Invoke-DocumentSummary is private — call through module scope
        $Mod = Get-Module AITriad
        $bag = $using:Results
        $Item = $_
        $Params = $using:SharedParams
        # t/1728/t/1774 — the shared capture fn (private) runs inside this runspace
        # via the module scope. It never throws — it records a failure PSCustomObject
        # with the inner $_.ScriptStackTrace on error — so one doc's failure cannot
        # terminate the whole parallel block (which would kill every in-flight doc).
        # See Invoke-DocSummaryWithCapture.
        $Result = & $Mod { param($D, $P) Invoke-DocSummaryWithCapture -Doc $D -Params $P } $Item $Params
        [void]$bag.Add($Result)
    } -ThrottleLimit $MaxConcurrent
}
