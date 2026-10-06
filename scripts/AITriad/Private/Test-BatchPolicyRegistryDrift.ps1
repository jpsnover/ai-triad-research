# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-BatchPolicyRegistryDrift {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 9 (t/3910, t/3943): a READ-ONLY check that WARNs when any
        taxonomy node has a policy action with no policy_id.
    .DESCRIPTION
        This step used to call `Update-PolicyRegistry -Fix`, which re-scanned ALL taxonomy
        files corpus-wide and minted registry ids for every null-policy_id node it found,
        not just ones touched by the batch. That silently rewrote taxonomy files for
        pre-existing, unrelated nodes on every summarization run, with no attribution.
        Registry consolidation is now a deliberate, separate data change
        (Update-PolicyRegistry -Fix, run on its own); this step never writes a taxonomy file.
    #>
    [CmdletBinding()]
    param()

    Write-Step 'Checking policy registry consistency (read-only)'
    try {
        $DriftNodeIds = @(Get-UnregisteredPolicyActionNodeIds)
        if ($DriftNodeIds.Count -gt 0) {
            Write-Warning "Invoke-BatchSummary: $($DriftNodeIds.Count) taxonomy node(s) have a policy action with no policy_id ($($DriftNodeIds -join ', ')) -- run Update-PolicyRegistry -Fix as its own deliberate data change (t/3943); batch summarization no longer auto-fixes this."
        }
        else {
            Write-OK 'Policy registry consistent -- no unregistered policy actions found'
        }
    }
    catch {
        Write-Warn "Policy registry drift check failed: $_ — run Update-PolicyRegistry manually to inspect"
    }
}
