# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-BatchDocumentSet {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 6 (t/3910): summarize every doc down one of three paths,
        adding one result object per doc to -Results.
    .DESCRIPTION
        - -IterativeExtraction or -AutoFire: FIRE, via Invoke-POVSummary (sequential).
        - -MaxConcurrent 1: sequential Invoke-DocSummaryWithCapture, with debate context.
        - otherwise: parallel Invoke-DocSummaryWithCapture runspaces.
        Results go into the caller's bag rather than being returned, so anything the
        summarizers write to the pipeline still flows out of Invoke-BatchSummary unchanged.
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][System.Collections.Generic.List[hashtable]]$Doc,
        [Parameter(Mandatory)][hashtable]$SharedParams,
        [Parameter(Mandatory)][hashtable]$DebateContext,
        [Parameter(Mandatory)][System.Collections.Concurrent.ConcurrentBag[object]]$Results,
        [int]$MaxConcurrent = 1,
        [switch]$IterativeExtraction,
        [switch]$AutoFire
    )

    if ($IterativeExtraction -or $AutoFire) {
        Invoke-BatchFireSummarySet -Doc $Doc -SharedParams $SharedParams -Results $Results -IterativeExtraction:$IterativeExtraction -AutoFire:$AutoFire
    }
    elseif ($MaxConcurrent -le 1) {
        $SystemPrompt = Get-BatchDebateSystemPrompt -BaseTemplate $SharedParams['SystemPromptTemplate'] -DebateContext $DebateContext
        foreach ($Item in $Doc) {
            $DocSharedParams = $SharedParams.Clone()
            $DocSharedParams['SystemPromptTemplate'] = $SystemPrompt
            # t/1774 — shared capture: never throws, returns a failure record on error.
            $Result = Invoke-DocSummaryWithCapture -Doc $Item -Params $DocSharedParams
            if ($Result.PSObject.Properties['Success'] -and -not $Result.Success) {
                Write-Warn "  ✗ $($Item.DocId) — $($Result.Error)"
            }
            $Results.Add($Result)
        }
    }
    else {
        Invoke-BatchParallelSummarySet -Doc $Doc -SharedParams $SharedParams -Results $Results -MaxConcurrent $MaxConcurrent
    }
}
