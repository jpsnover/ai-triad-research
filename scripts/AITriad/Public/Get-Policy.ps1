# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Policy {
    <#
    .SYNOPSIS
        Look up policies from the policy action registry.
    .DESCRIPTION
        Searches the policy_actions.json registry by ID, keyword, or POV.
        Returns policy entries with their cross-node usage and edge summary.
    .PARAMETER Id
        One or more policy IDs (e.g. pol-001). Supports wildcards.
    .PARAMETER Keyword
        Search action text for this keyword (case-insensitive).
    .PARAMETER POV
        Filter to policies used by this POV.
    .PARAMETER CrossPOV
        Show only policies shared across multiple POVs.
    .PARAMETER IncludeUsage
        Include which nodes reference each policy and their framings.
    .EXAMPLE
        Get-Policy -Id pol-001
    .EXAMPLE
        Get-Policy -Keyword "retraining"
    .EXAMPLE
        Get-Policy -CrossPOV
    .EXAMPLE
        Get-Policy -POV accelerationist -IncludeUsage
    #>
    [CmdletBinding(DefaultParameterSetName = 'All')]
    param(
        [Parameter(ParameterSetName = 'ById', Position = 0)]
        [string[]]$Id,

        [Parameter(ParameterSetName = 'ByKeyword')]
        [string]$Keyword,

        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')]
        [string]$POV,

        [switch]$CrossPOV,

        [switch]$IncludeUsage
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $RegistryPath = Join-Path $TaxDir 'policy_actions.json'

    if (-not (Test-Path $RegistryPath)) {
        Write-Fail 'Policy registry not found. Run Find-PolicyAction to generate it.'
        return
    }

    $Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json -Depth 20
    $Policies = @($Registry.policies)

    # ── Filter ──
    if ($Id) {
        $Policies = @($Policies | Where-Object {
            foreach ($Pattern in $Id) {
                if ($_.id -like $Pattern) { return $true }
            }
            return $false
        })
    }

    if ($Keyword) {
        $Policies = @($Policies | Where-Object { $_.action -match [regex]::Escape($Keyword) })
    }

    if ($POV) {
        $Policies = @($Policies | Where-Object { $_.source_povs -contains $POV })
    }

    if ($CrossPOV) {
        $Policies = @($Policies | Where-Object { $_.source_povs.Count -gt 1 })
    }

    # ── Build usage map if requested ──
    $UsageMap = @{}
    if ($IncludeUsage) {
        $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')
        foreach ($PovKey in $PovFiles) {
            $FilePath = Join-Path $TaxDir "$PovKey.json"
            if (-not (Test-Path $FilePath)) { continue }
            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
            foreach ($Node in $FileData.nodes) {
                if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
                if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }
                foreach ($PA in $Node.graph_attributes.policy_actions) {
                    $Pid = $PA.policy_id
                    if (-not $Pid) { continue }
                    if (-not $UsageMap.ContainsKey($Pid)) {
                        $UsageMap[$Pid] = [System.Collections.Generic.List[object]]::new()
                    }
                    $UsageMap[$Pid].Add([PSCustomObject]@{
                        NodeId  = $Node.id
                        POV     = $PovKey
                        Framing = $PA.framing
                    })
                }
            }
        }
    }

    # ── Output ──
    foreach ($Pol in $Policies) {
        $Out = [PSCustomObject]@{
            Id          = $Pol.id
            Action      = $Pol.action
            SourcePOVs  = $Pol.source_povs -join ', '
            MemberCount = $Pol.member_count
        }

        if ($IncludeUsage -and $UsageMap.ContainsKey($Pol.id)) {
            $Out | Add-Member -NotePropertyName 'Usage' -NotePropertyValue @($UsageMap[$Pol.id])
        }

        $Out
    }
}
