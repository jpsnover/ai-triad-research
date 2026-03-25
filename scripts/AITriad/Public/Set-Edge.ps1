# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Set-Edge {
    <#
    .SYNOPSIS
        Modifies properties of one or more edges in the taxonomy graph.
    .DESCRIPTION
        Updates edge properties in edges.json. Accepts edges by index or from
        the pipeline (output of Get-Edge). Supports changing status, confidence,
        strength, notes, and type. Uses ShouldProcess for safety.

        When piping from Get-Edge, each edge's Index property is used to locate
        the edge in edges.json.
    .PARAMETER Index
        Zero-based index of the edge to modify. Mutually exclusive with pipeline input.
    .PARAMETER InputObject
        Edge objects from Get-Edge (pipeline input). Each must have an Index property.
    .PARAMETER Status
        New approval status: proposed, approved, or rejected.
    .PARAMETER Confidence
        New confidence value (0.0-1.0).
    .PARAMETER Strength
        New strength value: strong, moderate, or weak.
    .PARAMETER Notes
        New notes text. Use empty string to clear.
    .PARAMETER Type
        New edge type (e.g., SUPPORTS, CONTRADICTS).
    .PARAMETER RepoRoot
        Path to the repository root.
    .PARAMETER PassThru
        Return the updated edge objects.
    .EXAMPLE
        Set-Edge -Index 42 -Status approved
        # Approve edge 42.
    .EXAMPLE
        Set-Edge -Index 10 -Notes 'Reviewed 2026-03-08 — strong relationship'
        # Add a note to edge 10.
    .EXAMPLE
        Get-Edge -Type CONTRADICTS -Status proposed | Set-Edge -Status approved
        # Approve all proposed contradictions.
    .EXAMPLE
        Get-Edge -NodeId 'acc-goals-001' -MinConfidence 0.9 | Set-Edge -Status approved
        # Approve high-confidence edges for a specific node.
    .EXAMPLE
        Get-Edge -Source 'saf-*' -Status proposed -MinConfidence 0.85 | Set-Edge -Status approved -PassThru
        # Bulk approve and see results.
    .EXAMPLE
        Set-Edge -Index 7 -Confidence 0.95 -Strength strong
        # Update confidence and strength on a single edge.
    #>
    [CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'ByIndex')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'ByIndex', Position = 0)]
        [int]$Index,

        [Parameter(Mandatory, ParameterSetName = 'ByPipeline', ValueFromPipeline)]
        [PSObject]$InputObject,

        [ValidateSet('proposed', 'approved', 'rejected')]
        [string]$Status,

        [ValidateRange(0.0, 1.0)]
        [double]$Confidence = -1,

        [ValidateSet('strong', 'moderate', 'weak', '')]
        [string]$Strength,

        [AllowEmptyString()]
        [string]$Notes,

        [string]$Type,

        [switch]$PassThru,

        [string]$RepoRoot = $script:RepoRoot
    )

    begin {
        Set-StrictMode -Version Latest

        $TaxDir    = Get-TaxonomyDir
        $EdgesPath = Join-Path $TaxDir 'edges.json'

        if (-not (Test-Path $EdgesPath)) {
            Write-Fail 'No edges.json found. Run Invoke-EdgeDiscovery first.'
            return
        }

        $EdgesData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json
        $MaxIndex  = $EdgesData.edges.Count - 1

        # Track whether any modifications were made
        $Modified      = $false
        $ModifiedCount = 0
        $Indices       = [System.Collections.Generic.List[int]]::new()

        # Validate that at least one property is being set
        $HasChange = $Status -or
                     $Confidence -ge 0 -or
                     $PSBoundParameters.ContainsKey('Strength') -or
                     $PSBoundParameters.ContainsKey('Notes') -or
                     $Type
        if (-not $HasChange) {
            Write-Fail 'Specify at least one property to change (-Status, -Confidence, -Strength, -Notes, -Type).'
            return
        }
    }

    process {
        # Determine edge index
        $EdgeIndex = if ($PSCmdlet.ParameterSetName -eq 'ByPipeline') {
            if (-not $InputObject.PSObject.Properties['Index']) {
                Write-Fail 'Pipeline object has no Index property. Pipe from Get-Edge.'
                return
            }
            $InputObject.Index
        } else {
            $Index
        }

        if ($EdgeIndex -lt 0 -or $EdgeIndex -gt $MaxIndex) {
            Write-Fail "Edge index $EdgeIndex out of range (0-$MaxIndex)."
            return
        }

        $E = $EdgesData.edges[$EdgeIndex]
        $Desc = "$($E.source) --[$($E.type)]--> $($E.target)"

        # Build change description for ShouldProcess
        $Changes = @()
        if ($Status)                               { $Changes += "status=$Status" }
        if ($Confidence -ge 0)                     { $Changes += "confidence=$Confidence" }
        if ($PSBoundParameters.ContainsKey('Strength')) { $Changes += "strength=$Strength" }
        if ($PSBoundParameters.ContainsKey('Notes'))    { $Changes += "notes=$(if ($Notes) { $Notes.Substring(0, [Math]::Min(40, $Notes.Length)) } else { '(clear)' })" }
        if ($Type)                                 { $Changes += "type=$Type" }

        $ChangeStr = $Changes -join ', '

        if ($PSCmdlet.ShouldProcess("Edge $EdgeIndex ($Desc)", "Set $ChangeStr")) {
            if ($Status) {
                $EdgesData.edges[$EdgeIndex].status = $Status
            }
            if ($Confidence -ge 0) {
                $EdgesData.edges[$EdgeIndex].confidence = $Confidence
            }
            if ($PSBoundParameters.ContainsKey('Strength')) {
                if ($Strength) {
                    if (-not $EdgesData.edges[$EdgeIndex].PSObject.Properties['strength']) {
                        $EdgesData.edges[$EdgeIndex] | Add-Member -NotePropertyName 'strength' -NotePropertyValue $Strength
                    } else {
                        $EdgesData.edges[$EdgeIndex].strength = $Strength
                    }
                } elseif ($EdgesData.edges[$EdgeIndex].PSObject.Properties['strength']) {
                    $EdgesData.edges[$EdgeIndex].PSObject.Properties.Remove('strength')
                }
            }
            if ($PSBoundParameters.ContainsKey('Notes')) {
                if ($Notes) {
                    if (-not $EdgesData.edges[$EdgeIndex].PSObject.Properties['notes']) {
                        $EdgesData.edges[$EdgeIndex] | Add-Member -NotePropertyName 'notes' -NotePropertyValue $Notes
                    } else {
                        $EdgesData.edges[$EdgeIndex].notes = $Notes
                    }
                } elseif ($EdgesData.edges[$EdgeIndex].PSObject.Properties['notes']) {
                    $EdgesData.edges[$EdgeIndex].PSObject.Properties.Remove('notes')
                }
            }
            if ($Type) {
                $EdgesData.edges[$EdgeIndex].type = $Type
            }

            $Modified = $true
            $ModifiedCount++
            $Indices.Add($EdgeIndex)
        }
    }

    end {
        if ($Modified) {
            $EdgesData.last_modified = (Get-Date).ToString('yyyy-MM-dd')
            $Json = $EdgesData | ConvertTo-Json -Depth 20
            try {
                Set-Content -Path $EdgesPath -Value $Json -Encoding UTF8
                Write-OK "Updated $ModifiedCount edge(s) in $EdgesPath"
            }
            catch {
                Write-Fail "Failed to write edges.json — $($_.Exception.Message)"
                Write-Info "Changes were made in memory but NOT saved to disk. Try again or check file permissions."
                throw
            }
        }

        if ($PassThru -and $Indices.Count -gt 0) {
            foreach ($Idx in $Indices) {
                $E = $EdgesData.edges[$Idx]
                [PSCustomObject]@{
                    PSTypeName    = 'AITriad.Edge'
                    Index         = $Idx
                    Source        = $E.source
                    Target        = $E.target
                    Type          = $E.type
                    Bidirectional = [bool]$E.bidirectional
                    Confidence    = $E.confidence
                    Status        = $E.status
                    Strength      = if ($E.PSObject.Properties['strength']) { $E.strength } else { $null }
                    Rationale     = $E.rationale
                    Notes         = if ($E.PSObject.Properties['notes']) { $E.notes } else { $null }
                    DiscoveredAt  = $E.discovered_at
                    Model         = $E.model
                }
            }
        }
    }
}
