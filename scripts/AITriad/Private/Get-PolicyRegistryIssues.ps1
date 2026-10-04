# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-PolicyRegistryIssues {
    <#
    .SYNOPSIS
        Test-TaxonomyIntegrity's Check 1 (t/3879 decomposition -- extracted verbatim, no
        behavior change): policy registry resolution.
    .DESCRIPTION
        Three sub-checks against policy_actions.json, each with its own pass/fail count:
          - PolicyRef (Error): a policy_id referenced by a node but absent from the registry.
          - Orphaned (Warning): a registry entry no node references.
          - MemberCount (Warning): a registry entry's member_count disagrees with the actual
            reference count.
        When policy_actions.json itself is absent, emits a single Registry (Error) issue
        instead and runs none of the three sub-checks -- mirrors the original's unconditional
        pre-check increment (one check attempted, whether or not the registry loads), so
        ChecksRun is always >= 1, never 0.

        Threads $Registry back to the caller (not dropped after this check): Test-TaxonomyIntegrity's
        Check 4 (edge integrity), Check 5 (embeddings), and the final report all read $Registry
        downstream of this check -- an explicit return field, not a closure capture, per the
        decomposition's shared-accumulator shape (t/3879, TL ruling).
    .PARAMETER RegistryPath
        Path to policy_actions.json.
    .PARAMETER PolicyRefs
        Hashtable: policy_id -> List[string] of node ids referencing it (from the load phase).
    .PARAMETER ActualCounts
        Hashtable: policy_id -> int actual reference count (from the load phase).
    .OUTPUTS
        [PSCustomObject] { Registry; ChecksRun; Passed; Issues }. Registry is $null when
        policy_actions.json doesn't exist.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$RegistryPath,

        [Parameter(Mandatory)]
        [hashtable]$PolicyRefs,

        [Parameter(Mandatory)]
        [hashtable]$ActualCounts
    )

    Set-StrictMode -Version Latest

    $Issues = [System.Collections.Generic.List[PSCustomObject]]::new()
    $ChecksRun = 0
    $Passed = 0
    $Registry = $null

    $ChecksRun++
    if (Test-Path $RegistryPath) {
        $Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
        $RegistryIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($Pol in $Registry.policies) { [void]$RegistryIds.Add($Pol.id) }

        # Unresolved refs
        $Unresolved = @($PolicyRefs.Keys | Where-Object { -not $RegistryIds.Contains($_) })
        if ($Unresolved.Count -gt 0) {
            $Issues.Add([PSCustomObject]@{ Check = 'PolicyRef'; Severity = 'Error'; Count = $Unresolved.Count; Detail = "policy_id refs not in registry: $($Unresolved -join ', ')" })
        } else { $Passed++ }

        # Orphaned
        $ChecksRun++
        $Orphaned = @($RegistryIds | Where-Object { -not $PolicyRefs.ContainsKey($_) })
        if ($Orphaned.Count -gt 0) {
            $Issues.Add([PSCustomObject]@{ Check = 'Orphaned'; Severity = 'Warning'; Count = $Orphaned.Count; Detail = "registry entries with no node refs: $($Orphaned[0..([Math]::Min(4, $Orphaned.Count-1))] -join ', ')$(if ($Orphaned.Count -gt 5) { ' ...' })" })
        } else { $Passed++ }

        # member_count accuracy
        $ChecksRun++
        $CountMismatches = 0
        foreach ($Pol in $Registry.policies) {
            if ($ActualCounts.ContainsKey($Pol.id)) { $Actual = $ActualCounts[$Pol.id] } else { $Actual = 0 }
            if ($Pol.member_count -ne $Actual) { $CountMismatches++ }
        }
        if ($CountMismatches -gt 0) {
            $Issues.Add([PSCustomObject]@{ Check = 'MemberCount'; Severity = 'Warning'; Count = $CountMismatches; Detail = "$CountMismatches policies have inaccurate member_count" })
        } else { $Passed++ }
    }
    else {
        $Issues.Add([PSCustomObject]@{ Check = 'Registry'; Severity = 'Error'; Count = 1; Detail = 'policy_actions.json not found' })
    }

    return [PSCustomObject]@{
        Registry  = $Registry
        ChecksRun = $ChecksRun
        Passed    = $Passed
        Issues    = $Issues
    }
}
