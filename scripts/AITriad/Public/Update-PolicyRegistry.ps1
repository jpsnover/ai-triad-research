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
                # Capture action/framing too (t/3435): needed to RE-ADD a referenced-but-unregistered
                # id back into the registry (Missing set) — the node is the only place its action lives.
                $ReferencedIds[$Pid].Add([PSCustomObject]@{
                    NodeId  = $Node.id
                    POV     = $PovKey
                    Action  = if ($PA.PSObject.Properties['action']) { $PA.action } else { $null }
                    Framing = if ($PA.PSObject.Properties['framing']) { $PA.framing } else { $null }
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
            # MaxId over registry ids UNION all referenced-on-disk ids (t/3431 #3): a prior partial run
            # may have written a pol-NNNN reference to a node WITHOUT persisting the registry (the very
            # bug this fixes). Counting referenced-but-unregistered ids here prevents a re-run from
            # re-minting the same number onto the next unregistered action (id collision).
            $MaxId = 0
            $idPool = [System.Collections.Generic.List[string]]::new()
            foreach ($Key in $ExistingPolicies.Keys)   { $idPool.Add([string]$Key) }
            foreach ($Key in $AllReferencedIds)         { $idPool.Add([string]$Key) }
            foreach ($Key in $idPool) {
                if ($Key -match 'pol-(\d+)') {
                    $Num = [int]$Matches[1]
                    if ($Num -gt $MaxId) { $MaxId = $Num }
                }
            }

            # Pass 1: assign IDs + register in memory, and record each node edit grouped BY FILE.
            # No file writes in this loop — a per-iteration whole-file rewrite self-dirties the file and
            # the BLOCK-tier dirty-tree guard then false-blocks the 2nd write, aborting mid-run and
            # leaving the file referencing an unpersisted id (t/3431). Batch → one write per file below.
            $fileAssignments = @{}   # POV key -> List of @{ NodeId; Action; NewId }
            foreach ($U in $Unregistered) {
                $MaxId++
                $NewId = 'pol-{0:D3}' -f $MaxId
                $ExistingPolicies[$NewId] = [PSCustomObject]@{
                    id           = $NewId
                    action       = $U.Action
                    source_povs  = @($U.POV)
                    member_count = 1
                    status       = 'active'
                }
                if (-not $fileAssignments.ContainsKey($U.POV)) {
                    $fileAssignments[$U.POV] = [System.Collections.Generic.List[object]]::new()
                }
                $fileAssignments[$U.POV].Add([PSCustomObject]@{ NodeId = $U.NodeId; Action = $U.Action; NewId = $NewId })
                Write-Info "  Assigned $NewId to $($U.NodeId)`: $($U.Action.Substring(0, [Math]::Min(50, $U.Action.Length)))"
            }

            # Pass 2: ONE whole-file rewrite per touched POV file (no self-dirtying → guard never
            # false-fires). Node-match logic (action text + no existing policy_id, first-match break)
            # is preserved, so duplicate action text within a node still maps to distinct ids in order.
            foreach ($PovKey in $fileAssignments.Keys) {
                $FilePath = Join-Path $TaxDir "$PovKey.json"
                $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json
                foreach ($Asg in $fileAssignments[$PovKey]) {
                    foreach ($Node in $FileData.nodes) {
                        if ($Node.id -ne $Asg.NodeId) { continue }
                        foreach ($PA in $Node.graph_attributes.policy_actions) {
                            if ($PA.action -eq $Asg.Action -and (-not $PA.PSObject.Properties['policy_id'] -or $null -eq $PA.policy_id)) {
                                $PA | Add-Member -NotePropertyName 'policy_id' -NotePropertyValue $Asg.NewId -Force
                                break
                            }
                        }
                    }
                }
                $FileData | ConvertTo-Json -Depth 20 | Write-Utf8NoBom -Path $FilePath
            }
        }

        # Re-add "missing from registry" ids — referenced-but-unregistered (t/3435). A prior partial run
        # wrote pol-NNNN onto nodes without persisting the registry (e.g. pol-3368/3369); the id then
        # lives ONLY on the node. Recreate the registry entry from the referencing node's action —
        # registry-only change (nodes already carry the id → no POV-file write). member_count/source_povs
        # are corrected by the re-scan below. Idempotent: once added, a re-run reports Missing 0.
        if ($Missing.Count -gt 0 -and $PSCmdlet.ShouldProcess("$($Missing.Count) missing-from-registry ids", 'Re-add to registry')) {
            $ReAdded = 0
            foreach ($Mid in $Missing) {
                $refs = @($ReferencedIds[$Mid])
                $withAction = @($refs | Where-Object { $_.PSObject.Properties['Action'] -and -not [string]::IsNullOrWhiteSpace([string]$_.Action) })
                if ($withAction.Count -eq 0) {
                    # Fallback-path logging (docs/error-handling.md): referenced id with no recoverable
                    # action text — cannot faithfully reconstruct the registry entry, so skip + surface.
                    Write-Warning "  $Mid referenced but no action text on any node — skipping re-add (t/3435)."
                    continue
                }
                $first = $withAction[0]
                $povs  = @($refs | ForEach-Object { $_.POV } | Sort-Object -Unique)
                $ExistingPolicies[$Mid] = [PSCustomObject]@{
                    id           = $Mid
                    action       = [string]$first.Action
                    source_povs  = $povs
                    member_count = $refs.Count
                    status       = 'active'
                }
                $ReAdded++
                $prev = [string]$first.Action
                $prev = $prev.Substring(0, [Math]::Min(50, $prev.Length))
                Write-Info "  Re-added $Mid from $($first.NodeId)`: $prev"
            }
            Write-OK "Re-added $ReAdded missing policies to registry"
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
            # Ensure new schema fields exist (preserve existing values)
            if (-not $Pol.PSObject.Properties['status'])       { $Pol | Add-Member -NotePropertyName 'status'       -NotePropertyValue 'active' }
            # Preserve: real_world_refs, last_refined_at, framing_count_at_refinement, superseded_by, merged_into
            # (no action needed — they survive the rebuild if already present)
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
