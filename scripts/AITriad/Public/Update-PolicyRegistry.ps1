# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-PolicyRegistry {
    <#
    .SYNOPSIS
        Rebuild and validate the policy action registry from taxonomy files.
    .DESCRIPTION
        Scans all POV and cross-cutting taxonomy files, collects every
        policy_actions entry, and rebuilds policy_actions.json.

        Detects and reports:
        - Orphaned policies (in registry but not referenced by any node)
        - Unregistered policies (referenced by nodes but missing from registry)
        - Stale member_count or source_povs fields

        Use -Fix to automatically repair issues (remove orphans, assign IDs
        to unregistered entries, update counts).

        This is the one registration entry point for every policy_actions writer (t/4004).
        Invoke-AttributeExtraction and Find-PolicyAction call it with -NodeId after their
        own writes, so IDs are minted by one implementation (Private/PolicyRegistryCore.ps1).
    .PARAMETER Fix
        Automatically fix detected issues.
    .PARAMETER PassThru
        Return a summary object.
    .PARAMETER NodeId
        Node-scoped mode (t/4004). Register only these nodes' policy_actions:
        mint IDs for their unregistered actions, re-add registry entries only for IDs
        they reference, and recount only the IDs in -PriorPolicyIds plus the IDs on
        these nodes now. Orphans are reported but never removed in this mode, so a
        scoped call never edits policies unrelated to the nodes just written.
    .PARAMETER PriorPolicyIds
        With -NodeId: the policy IDs the target nodes held BEFORE the caller's write.
        Recounting over these as well lets a dropped ID's member_count go down.
    .EXAMPLE
        Update-PolicyRegistry
    .EXAMPLE
        Update-PolicyRegistry -Fix
    .EXAMPLE
        Update-PolicyRegistry -Fix -NodeId skp-beliefs-313, skp-beliefs-314 -PriorPolicyIds pol-041
    .LINK
        Show-AITriadHelp
    .LINK
        Find-PolicyAction
    .LINK
        Get-Policy
    .LINK
        Invoke-PolicyRefinement
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [switch]$Fix,
        [switch]$PassThru,
        [string[]]$NodeId,
        [AllowEmptyCollection()]
        [string[]]$PriorPolicyIds = @()
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $RegistryPath = Join-Path $TaxDir 'policy_actions.json'
    $Scoped = $PSBoundParameters.ContainsKey('NodeId')

    # ── Load existing registry ──
    $Policies = @{}
    $Registry = Read-PolicyRegistryFile -RegistryPath $RegistryPath
    if ($Registry) {
        foreach ($Pol in $Registry.policies) { $Policies[$Pol.id] = $Pol }
        Write-OK "Loaded registry: $($Registry.policies.Count) policies"
    }
    else {
        Write-Info 'No existing registry found — will create new one'
    }
    # Every id already on disk, captured before orphan removal: minting never reuses a just-removed
    # orphan's number, and Assert-PolicyIdsUnminted checks exactly this same taken set.
    $RegistryIdsOnDisk = @($Policies.Keys)

    # ── Scan all taxonomy files and detect issues ──
    $Scan = Get-PolicyReferenceScan -TaxDir $TaxDir
    $Targets = $null
    $Unregistered = @($Scan.Unregistered)
    if ($Scoped) {
        $Targets = [System.Collections.Generic.HashSet[string]]::new([string[]]@($NodeId))
        $Unregistered = @($Unregistered | Where-Object { $Targets.Contains($_.NodeId) })
    }
    $Orphans = @($Policies.Keys | Where-Object { -not $Scan.Referenced.ContainsKey($_) })
    $Missing = @($Scan.Referenced.Keys | Where-Object { -not $Policies.ContainsKey($_) })
    if ($Scoped) {
        $OnTargets = Get-PolicyIdsOnNodes -Referenced $Scan.Referenced -Targets $Targets
        $Missing = @($Missing | Where-Object { $OnTargets -contains $_ })
    }

    Write-PolicyRegistryReport -Referenced $Scan.Referenced -Policies $Policies -Orphans $Orphans -Missing $Missing -Unregistered $Unregistered

    # ── Fix if requested ──
    if ($Fix) {
        Write-Step 'Fixing registry...'

        # Orphan removal is corpus-wide only: a node-scoped call must not delete unrelated policies.
        if (-not $Scoped -and $Orphans.Count -gt 0 -and $PSCmdlet.ShouldProcess("$($Orphans.Count) orphaned policies", 'Remove')) {
            foreach ($Oid in $Orphans) { $Policies.Remove($Oid) }
            Write-OK "Removed $($Orphans.Count) orphaned policies"
        }

        if ($Unregistered.Count -gt 0 -and $PSCmdlet.ShouldProcess("$($Unregistered.Count) unregistered actions", 'Assign IDs')) {
            $Taken = @($RegistryIdsOnDisk) + @($Scan.Referenced.Keys)
            $Minted = New-PolicyRegistryAssignments -Unregistered $Unregistered -Policies $Policies -TakenIds $Taken
            Assert-PolicyIdsUnminted -TaxDir $TaxDir -RegistryPath $RegistryPath -MintedIds @($Minted.Assignments | ForEach-Object { $_.NewId })
            Set-PolicyIdsOnNodes -TaxDir $TaxDir -Assignments $Minted.Assignments
        }

        if ($Missing.Count -gt 0 -and $PSCmdlet.ShouldProcess("$($Missing.Count) missing-from-registry ids", 'Re-add to registry')) {
            Add-MissingPolicyEntries -Policies $Policies -Referenced $Scan.Referenced -Missing $Missing
        }

        # ── Recount member_count and source_povs from a fresh scan ──
        $Final = Get-PolicyReferenceScan -TaxDir $TaxDir
        if ($Scoped) {
            $RecountIds = @(@($PriorPolicyIds) + @(Get-PolicyIdsOnNodes -Referenced $Final.Referenced -Targets $Targets) | Sort-Object -Unique)
            Update-PolicyMemberCounts -Policies $Policies -Referenced $Final.Referenced -Ids $RecountIds
        }
        else {
            Update-PolicyMemberCounts -Policies $Policies -Referenced $Final.Referenced
        }

        Save-PolicyRegistry -RegistryPath $RegistryPath -Policies $Policies -Cmdlet $PSCmdlet
    }

    if ($PassThru) {
        [PSCustomObject]@{
            TotalPolicies = $Policies.Count
            Referenced    = $Scan.Referenced.Count
            Orphans       = $Orphans.Count
            Unregistered  = $Unregistered.Count
            Missing       = $Missing.Count
        }
    }
}
