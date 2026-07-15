# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-CriticalInteraction {
    <#
    .SYNOPSIS
        Enumerates Critical User Interactions (CUIs) from the catalog.
    .DESCRIPTION
        Returns structured CUI objects from the built-in catalog. Use filters
        to narrow by domain, priority level, or test coverage level.
    .PARAMETER Domain
        Filter by domain: Taxonomy, Debate, AI, Auth, Admin, Community, Data, Calibration.
    .PARAMETER Priority
        Filter by priority level: P0, P1, P2.
    .PARAMETER Level
        Filter by test level coverage: API (has API checks), UX (has UX steps),
        Both (has both API and UX).
    .EXAMPLE
        Get-CriticalInteraction
        Returns all 28 CUIs.
    .EXAMPLE
        Get-CriticalInteraction -Priority P0
        Returns only P0 (blocking) CUIs.
    .EXAMPLE
        Get-CriticalInteraction -Domain Debate -Level API
        Returns debate CUIs that have API-level tests defined.
    .LINK
        Show-AITriadHelp
    .LINK
        Show-DebateDiagnostics
    .LINK
        Show-DebateHarvest
    .LINK
        Convert-DebateToAudio
    .LINK
        Get-AITClaim
    .LINK
        Test-CriticalInteractions
    .LINK
        Get-TopicFrequency
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [ValidateSet('Taxonomy', 'Debate', 'AI', 'Auth', 'Admin', 'Community', 'Data', 'Calibration')]
        [string]$Domain,

        [Parameter()]
        [ValidateSet('P0', 'P1', 'P2')]
        [string]$Priority,

        [Parameter()]
        [ValidateSet('API', 'UX', 'Both')]
        [string]$Level
    )

    Set-StrictMode -Version Latest

    foreach ($Entry in $script:CuiCatalog) {
        if ($Domain -and $Entry.Domain -ne $Domain) { continue }
        if ($Priority -and $Entry.Priority -ne $Priority) { continue }

        $HasApi = $Entry.ApiChecks -gt 0
        $HasUx  = $Entry.UxSteps -gt 0

        if ($Level) {
            $Skip = $false
            switch ($Level) {
                'API'  { if (-not $HasApi) { $Skip = $true } }
                'UX'   { if (-not $HasUx)  { $Skip = $true } }
                'Both' { if (-not ($HasApi -and $HasUx)) { $Skip = $true } }
            }
            if ($Skip) { continue }
        }

        $TestLevel = if ($HasApi -and $HasUx) { 'Both' }
                     elseif ($HasApi)          { 'API' }
                     elseif ($HasUx)           { 'UX' }
                     else                      { 'None' }

        [PSCustomObject]@{
            PSTypeName    = 'CriticalInteraction'
            Id            = $Entry.Id
            Domain        = $Entry.Domain
            Priority      = $Entry.Priority
            Title         = $Entry.Title
            Description   = $Entry.Description
            Preconditions = $Entry.Preconditions
            ApiChecks     = [int]$Entry.ApiChecks
            UxSteps       = [int]$Entry.UxSteps
            HasScreenshot = [bool]$Entry.HasScreenshot
            Level         = $TestLevel
        }
    }
}
