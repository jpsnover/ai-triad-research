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
    .PARAMETER Fix
        Automatically fix detected issues.
    .PARAMETER PassThru
        Return a summary object.
    .EXAMPLE
        Update-PolicyRegistry
    .EXAMPLE
        Update-PolicyRegistry -Fix
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [switch]$Fix,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $TaxDir = Get-TaxonomyDir
    $RegistryPath = Join-Path $TaxDir 'policy_actions.json'

    # ── Load existing registry ──
    $Registry = $null
    $ExistingPolicies = @{}
    if (Test-Path $RegistryPath) {
        $Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
        foreach ($Pol in $Registry.policies) {
            $ExistingPolicies[$Pol.id] = $Pol
        }
        Write-OK "Loaded registry: $($Registry.policies.Count) policies"
    }
    else {
        Write-Info 'No existing registry found — will create new one'
    }

    # ── Scan all taxonomy files ──
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    $ReferencedIds = @{}  # policy_id -> list of { NodeId, POV, Action, Framing }
    $Unregistered  = [System.Collections.Generic.List[object]]::new()

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json

        foreach ($Node in $FileData.nodes) {
            if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
            if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }

            foreach ($PA in $Node.graph_attributes.policy_actions) {
                if ($PA.PSObject.Properties['policy_id']) { $Pid = $PA.policy_id } else { $Pid = $null }

                if (-not $Pid) {
                    $Unregistered.Add([PSCustomObject]@{
                        NodeId  = $Node.id
                        POV     = $PovKey
                        Action  = $PA.action
                        Framing = $PA.framing
                    })
                    continue
                }

                if (-not $ReferencedIds.ContainsKey($Pid)) {
                    $ReferencedIds[$Pid] = [System.Collections.Generic.List[object]]::new()
                }
                $ReferencedIds[$Pid].Add([PSCustomObject]@{
                    NodeId = $Node.id
                    POV    = $PovKey
                })
            }
        }
    }

    # ── Detect issues ──
    $AllRegisteredIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Key in $ExistingPolicies.Keys) { [void]$AllRegisteredIds.Add($Key) }

    $AllReferencedIds = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($Key in $ReferencedIds.Keys) { [void]$AllReferencedIds.Add($Key) }

    $Orphans = @($AllRegisteredIds | Where-Object { -not $AllReferencedIds.Contains($_) })
    $Missing = @($AllReferencedIds | Where-Object { -not $AllRegisteredIds.Contains($_) })

    Write-Host ''
    Write-Host '=== Policy Registry Validation ===' -ForegroundColor Cyan
    Write-Host "  Referenced by nodes:  $($ReferencedIds.Count) unique policy IDs" -ForegroundColor White
    Write-Host "  In registry:         $($ExistingPolicies.Count) policies" -ForegroundColor White
    Write-Host "  Orphaned:            $($Orphans.Count)" -ForegroundColor $(if ($Orphans.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "  Missing from registry: $($Missing.Count)" -ForegroundColor $(if ($Missing.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "  Unregistered (no ID):  $($Unregistered.Count)" -ForegroundColor $(if ($Unregistered.Count -gt 0) { 'Yellow' } else { 'Green' })

    if ($Orphans.Count -gt 0) {
        Write-Warn 'Orphaned policies (in registry but not referenced):'
        foreach ($Oid in $Orphans | Select-Object -First 10) {
            $Pol = $ExistingPolicies[$Oid]
            Write-Host "    $Oid`: $($Pol.action.Substring(0, [Math]::Min(80, $Pol.action.Length)))" -ForegroundColor Yellow
        }
        if ($Orphans.Count -gt 10) { Write-Host "    ... +$($Orphans.Count - 10) more" -ForegroundColor Yellow }
    }

    if ($Unregistered.Count -gt 0) {
        Write-Warn 'Policy actions without policy_id:'
        foreach ($U in $Unregistered | Select-Object -First 5) {
            Write-Host "    $($U.NodeId) [$($U.POV)]: $($U.Action.Substring(0, [Math]::Min(80, $U.Action.Length)))" -ForegroundColor Yellow
        }
        if ($Unregistered.Count -gt 5) { Write-Host "    ... +$($Unregistered.Count - 5) more" -ForegroundColor Yellow }
    }

    # ── Fix if requested ──
    if ($Fix -and ($Orphans.Count -gt 0 -or $Unregistered.Count -gt 0 -or $true)) {
        Write-Step 'Fixing registry...'

        # Remove orphans
        if ($Orphans.Count -gt 0 -and $PSCmdlet.ShouldProcess("$($Orphans.Count) orphaned policies", 'Remove')) {
            foreach ($Oid in $Orphans) {
                $ExistingPolicies.Remove($Oid)
            }
            Write-OK "Removed $($Orphans.Count) orphaned policies"
        }

        # Assign IDs to unregistered actions
        if ($Unregistered.Count -gt 0 -and $PSCmdlet.ShouldProcess("$($Unregistered.Count) unregistered actions", 'Assign IDs')) {
            $MaxId = 0
            foreach ($Key in $ExistingPolicies.Keys) {
                if ($Key -match 'pol-(\d+)') {
                    $Num = [int]$Matches[1]
                    if ($Num -gt $MaxId) { $MaxId = $Num }
                }
            }

            foreach ($U in $Unregistered) {
                $MaxId++
                $NewId = 'pol-{0:D3}' -f $MaxId
                $ExistingPolicies[$NewId] = [PSCustomObject]@{
                    id           = $NewId
                    action       = $U.Action
                    source_povs  = @($U.POV)
                    member_count = 1
                }

                # Update the node in the taxonomy file
                $FilePath = Join-Path $TaxDir "$($U.POV).json"
                $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
                foreach ($Node in $FileData.nodes) {
                    if ($Node.id -ne $U.NodeId) { continue }
                    foreach ($PA in $Node.graph_attributes.policy_actions) {
                        if ($PA.action -eq $U.Action -and (-not $PA.PSObject.Properties['policy_id'] -or $null -eq $PA.policy_id)) {
                            $PA | Add-Member -NotePropertyName 'policy_id' -NotePropertyValue $NewId -Force
                            break
                        }
                    }
                }
                $FileData | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $FilePath 
                Write-Info "  Assigned $NewId to $($U.NodeId)`: $($U.Action.Substring(0, [Math]::Min(50, $U.Action.Length)))"
            }
        }

        # Rebuild member_count and source_povs
        # Re-scan after fixes
        $FinalRefs = @{}
        foreach ($PovKey in $PovFiles) {
            $FilePath = Join-Path $TaxDir "$PovKey.json"
            if (-not (Test-Path $FilePath)) { continue }
            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
            foreach ($Node in $FileData.nodes) {
                if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
                if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }
                foreach ($PA in $Node.graph_attributes.policy_actions) {
                    if ($PA.PSObject.Properties['policy_id']) { $Pid = $PA.policy_id } else { $Pid = $null }
                    if (-not $Pid) { continue }
                    if (-not $FinalRefs.ContainsKey($Pid)) {
                        $FinalRefs[$Pid] = @{ Count = 0; POVs = [System.Collections.Generic.HashSet[string]]::new() }
                    }
                    $FinalRefs[$Pid].Count++
                    [void]$FinalRefs[$Pid].POVs.Add($PovKey)
                }
            }
        }

        foreach ($Pid in $ExistingPolicies.Keys) {
            $Pol = $ExistingPolicies[$Pid]
            if ($FinalRefs.ContainsKey($Pid)) {
                $Pol.member_count = $FinalRefs[$Pid].Count
                $Pol.source_povs  = @($FinalRefs[$Pid].POVs | Sort-Object)
            }
        }

        # Write registry
        $NewRegistry = [PSCustomObject]@{
            _schema_version = '1.0.0'
            _doc            = 'Canonical policy action registry. Each policy has a unique ID. Nodes reference policies by ID with POV-specific framing.'
            policy_count    = $ExistingPolicies.Count
            policies        = @($ExistingPolicies.Values | Sort-Object id)
        }

        if ($PSCmdlet.ShouldProcess($RegistryPath, 'Write rebuilt policy registry')) {
            $NewRegistry | ConvertTo-Json -Depth 10 | Write-Utf8NoBom -Path $RegistryPath 
            Write-OK "Registry saved: $($ExistingPolicies.Count) policies"
        }
    }

    if ($PassThru) {
        [PSCustomObject]@{
            TotalPolicies = $ExistingPolicies.Count
            Referenced    = $ReferencedIds.Count
            Orphans       = $Orphans.Count
            Unregistered  = $Unregistered.Count
            Missing       = $Missing.Count
        }
    }
}
