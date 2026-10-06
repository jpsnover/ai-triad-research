# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-BatchFireSummarySet {
    <#
    .SYNOPSIS
        Invoke-BatchSummary's FIRE path (t/3910): each doc through Invoke-POVSummary
        (-IterativeExtraction or -AutoFire), sequentially, with stats read back from the
        written summary. Adds one result per doc to -Results; a throwing doc is recorded
        as a failure, not rethrown.
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][System.Collections.Generic.List[hashtable]]$Doc,
        [Parameter(Mandatory)][hashtable]$SharedParams,
        [Parameter(Mandatory)][System.Collections.Concurrent.ConcurrentBag[object]]$Results,
        [switch]$IterativeExtraction,
        [switch]$AutoFire
    )

    if ($IterativeExtraction) { $FireMode = '-IterativeExtraction' } else { $FireMode = '-AutoFire' }
    Write-Info "Using Invoke-POVSummary path ($FireMode) for each document"

    foreach ($Item in $Doc) {
        $StartTime = Get-Date
        try {
            $PovParams = @{
                DocId       = $Item.DocId
                Model       = $SharedParams.Model
                ApiKey      = $SharedParams.ApiKey
                Temperature = $SharedParams.Temperature
                Force       = $true
            }
            if ($IterativeExtraction) { $PovParams['IterativeExtraction'] = $true }
            if ($AutoFire)            { $PovParams['AutoFire'] = $true }

            Invoke-POVSummary @PovParams

            $Elapsed = (Get-Date) - $StartTime
            $Stats = Get-BatchSummaryFileStat -SummaryPath (Join-Path $SharedParams.SummariesDir "$($Item.DocId).json")

            $Results.Add([PSCustomObject]@{
                Success       = $true
                DocId         = $Item.DocId
                TotalPoints   = $Stats.TotalPoints
                NullNodes     = 0
                FactualCount  = $Stats.FactualCount
                UnmappedCount = $Stats.UnmappedCount
                ElapsedSecs   = [int]$Elapsed.TotalSeconds
                ChunkCount    = 0
            })
        }
        catch {
            $Results.Add([PSCustomObject]@{
                Success = $false
                DocId   = $Item.DocId
                Error   = $_.Exception.Message
            })
        }
    }
}
