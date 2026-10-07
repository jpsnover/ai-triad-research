# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Steps of Update-PolicyRegistry that aren't shared minting logic (that lives in PolicyRegistryCore.ps1).

function Get-PolicyIdsOnNodes {
    # Every policy id referenced by at least one of the target nodes.
    param([Parameter(Mandatory)]$Referenced, [Parameter(Mandatory)]$Targets)
    return @($Referenced.Keys | Where-Object { @($Referenced[$_] | Where-Object { $Targets.Contains($_.NodeId) }).Count -gt 0 })
}

function Write-PolicyRegistryReport {
    # The validation summary printed on every run.
    param($Referenced, $Policies, $Orphans, $Missing, $Unregistered)
    Write-Host ''
    Write-Host '=== Policy Registry Validation ===' -ForegroundColor Cyan
    Write-Host "  Referenced by nodes:  $($Referenced.Count) unique policy IDs" -ForegroundColor White
    Write-Host "  In registry:         $($Policies.Count) policies" -ForegroundColor White
    Write-Host "  Orphaned:            $($Orphans.Count)" -ForegroundColor $(if ($Orphans.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "  Missing from registry: $($Missing.Count)" -ForegroundColor $(if ($Missing.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "  Unregistered (no ID):  $($Unregistered.Count)" -ForegroundColor $(if ($Unregistered.Count -gt 0) { 'Yellow' } else { 'Green' })

    if ($Orphans.Count -gt 0) {
        Write-Warn 'Orphaned policies (in registry but not referenced):'
        foreach ($Oid in $Orphans | Select-Object -First 10) {
            $Pol = $Policies[$Oid]
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
}

function Add-MissingPolicyEntries {
    <#
    .SYNOPSIS
        Re-adds referenced-but-unregistered ids (t/3435): a prior partial run wrote pol-NNNN onto nodes
        without persisting the registry, so the node is the only place the action lives. Registry-only;
        the nodes already carry the id. Idempotent: once added, a re-run reports Missing 0.
    #>
    param([hashtable]$Policies, $Referenced, [string[]]$Missing)
    $ReAdded = 0
    foreach ($Mid in $Missing) {
        $Refs = @($Referenced[$Mid])
        $WithAction = @($Refs | Where-Object { $_.PSObject.Properties['Action'] -and -not [string]::IsNullOrWhiteSpace([string]$_.Action) })
        if ($WithAction.Count -eq 0) {
            # Fallback-path logging: no recoverable action text, so the entry can't be rebuilt faithfully.
            Write-Warning "  $Mid referenced but no action text on any node — skipping re-add (t/3435)."
            continue
        }
        $First = $WithAction[0]
        $Povs  = @($Refs | ForEach-Object { $_.POV } | Sort-Object -Unique)
        $Policies[$Mid] = New-PolicyRegistryEntry -Id $Mid -Action ([string]$First.Action) -SourcePovs $Povs -MemberCount $Refs.Count
        $ReAdded++
        $Prev = [string]$First.Action
        Write-Info "  Re-added $Mid from $($First.NodeId)`: $($Prev.Substring(0, [Math]::Min(50, $Prev.Length)))"
    }
    Write-OK "Re-added $ReAdded missing policies to registry"
}

function Save-PolicyRegistry {
    <#
    .SYNOPSIS
        Writes the rebuilt registry, skipping the write when it's content-identical to disk. An
        unconditional rewrite of an already-dirty registry trips the dirty-tree guard and makes
        Invoke-BatchSummary report a spurious consolidation failure.
    #>
    param([string]$RegistryPath, [hashtable]$Policies, $Cmdlet)
    $NewRegistry = [PSCustomObject]@{
        _schema_version = '1.0.0'
        _doc            = 'Canonical policy action registry. Each policy has a unique ID. Nodes reference policies by ID with POV-specific framing.'
        policy_count    = $Policies.Count
        policies        = @($Policies.Values | Sort-Object id)
    }
    $NewJson = $NewRegistry | ConvertTo-Json -Depth 10
    $OnDisk  = if (Test-Path $RegistryPath) { Get-Content -Raw -Path $RegistryPath } else { $null }
    if ($null -ne $OnDisk -and ($OnDisk -replace '\r\n', "`n").TrimEnd() -ceq ($NewJson -replace '\r\n', "`n").TrimEnd()) {
        Write-OK "Registry already consistent: $($Policies.Count) policies — no write needed"
    }
    elseif ($Cmdlet.ShouldProcess($RegistryPath, 'Write rebuilt policy registry')) {
        $NewJson | Write-Utf8NoBom -Path $RegistryPath
        Write-OK "Registry saved: $($Policies.Count) policies"
    }
}
