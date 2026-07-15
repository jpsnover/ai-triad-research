# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-SynthesisCompleteness {
    <#
    .SYNOPSIS
        Validates synthesis completeness in a debate session JSON.
    .DESCRIPTION
        Finds the concluding transcript entry, checks metadata.synthesis for
        8 expected keys, and optionally cross-references diagnostics raw_response
        to detect parse-loss (data generated but lost in parsing).
    .PARAMETER Session
        Path to a debate session JSON file.
    .PARAMETER PassThru
        Return the results object for piping.
    .EXAMPLE
        Test-SynthesisCompleteness -Session debate-72a6e0a2.json
    .EXAMPLE
        Test-SynthesisCompleteness -Session debate-72a6e0a2.json -PassThru
    .LINK
        Show-AITriadHelp
    .LINK
        Compare-DebateQuality
    .LINK
        Compare-DebateRuns
    .LINK
        Measure-DebateQuality
    .LINK
        Invoke-DebateAB
    .LINK
        Get-CalibrationTrend
    .LINK
        Test-AITJudgeModel
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateScript({ Test-Path $_ })]
        [string]$Session,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $ExpectedKeys = @(
        'areas_of_agreement'
        'areas_of_disagreement'
        'cruxes'
        'unresolved_questions'
        'taxonomy_coverage'
        'argument_map'
        'preferences'
        'policy_implications'
    )

    $Data = Get-Content -Raw -Path $Session | ConvertFrom-Json

    # Find the concluding entry
    $Concluding = $null
    if ($Data.PSObject.Properties['transcript'] -and $Data.transcript) {
        $Concluding = @($Data.transcript | Where-Object {
            $_.PSObject.Properties['type'] -and $_.type -eq 'concluding'
        }) | Select-Object -First 1
    }

    if ($null -eq $Concluding) {
        Write-Host "`n  No concluding entry found in transcript." -ForegroundColor Yellow
        Write-Host "  Debate may not have reached synthesis phase." -ForegroundColor DarkGray
        if ($PassThru) {
            return [PSCustomObject]@{
                Session       = $Session
                HasConcluding = $false
                Score         = 0
                Total         = $ExpectedKeys.Count
                Fields        = @()
            }
        }
        return
    }

    # Extract synthesis object
    $Synthesis = $null
    if ($Concluding.PSObject.Properties['metadata'] -and $null -ne $Concluding.metadata -and
        $Concluding.metadata.PSObject.Properties['synthesis'] -and $null -ne $Concluding.metadata.synthesis) {
        $Synthesis = $Concluding.metadata.synthesis
    }

    # Load diagnostics for raw_response cross-reference
    $DiagEntries = @()
    $ConcludingId = if ($Concluding.PSObject.Properties['id']) { $Concluding.id } else { $null }
    if ($Data.PSObject.Properties['diagnostics'] -and $Data.diagnostics.PSObject.Properties['entries']) {
        $DiagEntries = @($Data.diagnostics.entries)
    }

    # Find raw responses for the concluding entry
    $RawResponses = @{}
    if ($ConcludingId -and $DiagEntries.Count -gt 0) {
        foreach ($Diag in $DiagEntries) {
            if ($null -eq $Diag) { continue }
            if (-not $Diag.PSObject.Properties['entry_id']) { continue }
            if ($Diag.entry_id -ne $ConcludingId) { continue }
            if ($Diag.PSObject.Properties['raw_response'] -and $Diag.raw_response) {
                $RawText = $Diag.raw_response
                foreach ($K in $ExpectedKeys) {
                    if ($RawText -match [regex]::Escape($K)) {
                        $RawResponses[$K] = $true
                    }
                }
            }
        }
    }

    # Evaluate each field
    $Results = [System.Collections.Generic.List[PSObject]]::new()
    $FilledCount = 0

    foreach ($Key in $ExpectedKeys) {
        $Present = $false
        $Count = 0
        $Status = 'MISSING'

        if ($null -ne $Synthesis -and $Synthesis.PSObject.Properties[$Key] -and $null -ne $Synthesis.$Key) {
            $Items = @($Synthesis.$Key)
            $Count = $Items.Count
            if ($Count -gt 0) {
                $Present = $true
                $Status = "OK ($Count entries)"
                $FilledCount++
            }
        }

        if (-not $Present) {
            if ($RawResponses.ContainsKey($Key)) {
                $Status = 'EMPTY (raw response had data — PARSE LOSS)'
            } elseif ($null -eq $Synthesis) {
                $Status = 'MISSING (no synthesis object)'
            } else {
                $Status = 'EMPTY'
            }
        }

        $Results.Add([PSCustomObject]@{
            Key    = $Key
            Status = $Status
            Count  = $Count
        })
    }

    # Determine overall rating
    $Rating = if ($FilledCount -eq $ExpectedKeys.Count) { 'COMPLETE' }
              elseif ($FilledCount -ge 6) { 'GOOD' }
              elseif ($FilledCount -ge 4) { 'PARTIAL' }
              elseif ($FilledCount -ge 1) { 'DEGRADED' }
              else { 'EMPTY' }

    $RatingColor = switch ($Rating) {
        'COMPLETE' { 'Green' }
        'GOOD'     { 'Green' }
        'PARTIAL'  { 'Yellow' }
        'DEGRADED' { 'Red' }
        'EMPTY'    { 'Red' }
    }

    # Display
    Write-Host "`n  SYNTHESIS COMPLETENESS" -ForegroundColor White
    Write-Host "  $('─' * 55)" -ForegroundColor DarkGray

    foreach ($R in $Results) {
        $FieldColor = if ($R.Count -gt 0) { 'Green' }
                      elseif ($R.Status -like '*PARSE LOSS*') { 'Red' }
                      else { 'Yellow' }
        $Label = ($R.Key -replace '_', ' ')
        Write-Host ('  {0,-30} : ' -f $Label) -ForegroundColor Gray -NoNewline
        Write-Host $R.Status -ForegroundColor $FieldColor
    }

    Write-Host "  $('─' * 55)" -ForegroundColor DarkGray
    Write-Host "  Completeness: $FilledCount/$($ExpectedKeys.Count) — " -ForegroundColor White -NoNewline
    Write-Host $Rating -ForegroundColor $RatingColor
    Write-Host ''

    if ($PassThru) {
        return [PSCustomObject]@{
            Session       = $Session
            HasConcluding = $true
            Score         = $FilledCount
            Total         = $ExpectedKeys.Count
            Rating        = $Rating
            Fields        = $Results.ToArray()
        }
    }
}
