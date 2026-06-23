# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-CuiTax002 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter()][int]$TimeoutSec = 15
    )

    Set-StrictMode -Version Latest
    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $Checks = [System.Collections.Generic.List[PSObject]]::new()

    # Check 1: Load accelerationist taxonomy and pick first node with graph_attributes
    $r = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path '/api/taxonomy/accelerationist' -TimeoutSec $TimeoutSec -ExpectedField 'nodes'
    $HasNodes = $r.Success -and $r.Body.PSObject.Properties['nodes'] -and @($r.Body.nodes).Count -gt 0
    $Checks.Add((New-CuiCheckResult -Check 'Taxonomy loads' -Pass $HasNodes `
        -Detail $(if ($HasNodes) { "$(@($r.Body.nodes).Count) nodes" } else { "Failed: $($r.Error)" }) -Ms $r.ResponseMs))

    # Check 2: Validate node has label, description, category
    $NodeValid = $false
    $EnrichedNode = $null
    if ($HasNodes) {
        foreach ($n in $r.Body.nodes) {
            if ($n.PSObject.Properties['label'] -and $n.PSObject.Properties['description'] -and $n.PSObject.Properties['category']) {
                $NodeValid = $true
                if ($n.PSObject.Properties['graph_attributes']) {
                    $EnrichedNode = $n
                    break
                }
            }
        }
    }
    $Checks.Add((New-CuiCheckResult -Check 'Node has label+description+category' -Pass $NodeValid `
        -Detail $(if ($NodeValid) { 'Valid' } else { 'Missing required fields' })))

    # Check 3: If graph_attributes present, validate at least one enriched field
    $AttrValid = $false
    if ($EnrichedNode) {
        $ga = $EnrichedNode.graph_attributes
        $AttrValid = $ga.PSObject.Properties['epistemic_type'] -or
                     $ga.PSObject.Properties['rhetorical_strategy'] -or
                     $ga.PSObject.Properties['policy_actions']
    }
    $Checks.Add((New-CuiCheckResult -Check 'Enriched node has graph_attributes' -Pass $AttrValid `
        -Detail $(if ($AttrValid) { 'Has enriched attributes' } elseif (-not $EnrichedNode) { 'No enriched node found (non-fatal)' } else { 'graph_attributes empty' })))

    $Sw.Stop()
    New-CuiTestResult -CuiId 'CUI-TAX-002' -Domain 'Taxonomy' -Priority 'P0' `
        -DurationMs $Sw.ElapsedMilliseconds -Details $Checks.ToArray()
}
