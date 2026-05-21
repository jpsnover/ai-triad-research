# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-AITSourceIndex {
    <#
    .SYNOPSIS
        Rebuilds the sources/_index.json file for fast source enumeration.
    .DESCRIPTION
        Scans all source folders under sources/, reads each metadata.json,
        and writes a lightweight index at sources/_index.json. This turns
        Get-AITSource from O(N×2 file reads) to O(1 file read).

        Called automatically after Import-AITriadDocument and Invoke-POVSummary.
        Can also be invoked manually after editing metadata by hand.
    .PARAMETER Quiet
        Suppress progress output.
    .EXAMPLE
        Update-AITSourceIndex
    .EXAMPLE
        Update-AITSourceIndex -Quiet
    #>
    [CmdletBinding()]
    param(
        [switch]$Quiet
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $SourcesDir = Get-SourcesDir
    if (-not (Test-Path $SourcesDir)) {
        if (-not $Quiet) { Write-Warning "Sources directory not found: $SourcesDir" }
        return
    }

    $SummariesDir = Get-SummariesDir
    $Folders = @(Get-ChildItem -Path $SourcesDir -Directory | Where-Object { $_.Name -ne '_inbox' })

    $Entries = [System.Collections.Generic.List[hashtable]]::new()

    foreach ($Folder in $Folders) {
        $MetaPath = Join-Path $Folder.FullName 'metadata.json'
        if (-not (Test-Path $MetaPath)) { continue }

        try {
            $Meta = Get-Content -Raw -Path $MetaPath | ConvertFrom-Json
        } catch {
            if (-not $Quiet) { Write-Warning "Failed to parse ${MetaPath}: $_" }
            continue
        }

        $Props = $Meta.PSObject.Properties

        # Load summary statistics — prefer cached values in metadata
        $TotalClaims      = 0
        $ClaimsByPov      = @{ accelerationist = 0; safetyist = 0; skeptic = 0; situations = 0 }
        $TotalFacts       = 0
        $UnmappedConcepts = 0

        if ($Props['total_claims']) {
            $TotalClaims = [int]$Meta.total_claims
            if ($Props['total_facts']) { $TotalFacts = [int]$Meta.total_facts }
            if ($Props['unmapped_concepts'] -and $Meta.unmapped_concepts -is [int]) { $UnmappedConcepts = [int]$Meta.unmapped_concepts }
            if ($Props['claims_by_pov'] -and $Meta.claims_by_pov) {
                $Cbp = $Meta.claims_by_pov
                $CbpProps = $Cbp.PSObject.Properties
                if ($CbpProps['accelerationist']) { $ClaimsByPov['accelerationist'] = [int]$Cbp.accelerationist }
                if ($CbpProps['safetyist'])       { $ClaimsByPov['safetyist']       = [int]$Cbp.safetyist }
                if ($CbpProps['skeptic'])         { $ClaimsByPov['skeptic']         = [int]$Cbp.skeptic }
                if ($CbpProps['situations'])      { $ClaimsByPov['situations']      = [int]$Cbp.situations }
            }
        } elseif ($null -ne $SummariesDir) {
            # Fall back to computing from summary file (legacy migration path)
            $SummaryPath = Join-Path $SummariesDir "$($Meta.id).json"
            if (Test-Path $SummaryPath) {
                try {
                    $Summary = Get-Content -Raw -Path $SummaryPath | ConvertFrom-Json
                    if ($Summary.factual_claims) {
                        $TotalClaims = @($Summary.factual_claims).Count
                    }
                    foreach ($Claim in @($Summary.factual_claims)) {
                        if (-not $Claim.PSObject.Properties['linked_taxonomy_nodes']) { continue }
                        foreach ($NodeId in @($Claim.linked_taxonomy_nodes)) {
                            if     ($NodeId -like 'acc-*') { $ClaimsByPov['accelerationist']++ }
                            elseif ($NodeId -like 'saf-*') { $ClaimsByPov['safetyist']++ }
                            elseif ($NodeId -like 'skp-*') { $ClaimsByPov['skeptic']++ }
                            elseif ($NodeId -like 'sit-*') { $ClaimsByPov['situations']++ }
                        }
                    }
                    foreach ($PovName in @('accelerationist', 'safetyist', 'skeptic')) {
                        $PovData = $Summary.pov_summaries.$PovName
                        if ($PovData -and $PovData.key_points) {
                            $TotalFacts += @($PovData.key_points).Count
                        }
                    }
                    if ($Summary.unmapped_concepts) {
                        $UnmappedConcepts = @($Summary.unmapped_concepts).Count
                    }
                } catch {
                    if (-not $Quiet) { Write-Verbose "Could not parse summary for $($Meta.id): $_" }
                }
            }
        }

        $Entry = [ordered]@{
            id               = $Meta.id
            title            = if ($Props['title'])          { $Meta.title }          else { $null }
            date_published   = if ($Props['date_published']) { $Meta.date_published } else { $null }
            date_ingested    = if ($Props['date_ingested'])  { $Meta.date_ingested }  else { $null }
            source_type      = if ($Props['source_type'])    { $Meta.source_type }    else { $null }
            pov_tags         = if ($Props['pov_tags'])        { @($Meta.pov_tags) }   else { @() }
            topic_tags       = if ($Props['topic_tags'])      { @($Meta.topic_tags) } else { @() }
            summary_status   = if ($Props['summary_status']) { $Meta.summary_status } else { $null }
            total_claims     = $TotalClaims
            claims_by_pov    = $ClaimsByPov
            total_facts      = $TotalFacts
            unmapped_concepts = $UnmappedConcepts
            one_liner        = if ($Props['one_liner'])      { $Meta.one_liner }      else { $null }
        }

        $Entries.Add($Entry)
    }

    $Index = [ordered]@{
        generated_at = (Get-Date -Format 'o')
        count        = $Entries.Count
        sources      = @($Entries)
    }

    $IndexPath = Join-Path $SourcesDir '_index.json'
    $Index | ConvertTo-Json -Depth 5 | Write-Utf8NoBom -Path $IndexPath

    if (-not $Quiet) {
        Write-Host "  Index updated: _index.json ($($Entries.Count) sources)" -ForegroundColor Green
    }
}
