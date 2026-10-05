# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-UnregisteredPolicyActionNodeIds {
    <#
    .SYNOPSIS
        Invoke-BatchSummary sub-helper (t/3943): read-only scan for taxonomy
        nodes with a policy action that has no policy_id.
    .DESCRIPTION
        Pure read -- never writes a taxonomy file. Separate from
        Update-PolicyRegistry (which performs the same detection but as a
        side effect of -Fix's registry rebuild) so Invoke-BatchSummary can
        report drift without minting registry entries or touching any POV
        file. t/3943: the old post-batch `Update-PolicyRegistry -Fix` call
        corpus-wide-rewrote taxonomy files for nodes unrelated to the batch
        just run.
    .OUTPUTS
        [string[]] -- node ids with at least one null-policy_id policy action.
        Empty array when the taxonomy is genuinely consistent. Throws
        (New-ActionableError) if any of the 4 taxonomy files is missing --
        a wrong/unreadable data root must surface as "check failed", never
        silently report "consistent" from having scanned nothing.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    Set-StrictMode -Version Latest

    $TaxDir = Get-TaxonomyDir
    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    $NodeIds = [System.Collections.Generic.List[string]]::new()

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) {
            New-ActionableError -Goal 'scan the taxonomy for unregistered policy actions' `
                -Problem "Taxonomy file missing: $FilePath" `
                -Location 'Get-UnregisteredPolicyActionNodeIds' `
                -NextSteps @('Verify the data root (Get-TaxonomyDir) resolves to the correct ai-triad-data checkout') -Throw
        }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json

        foreach ($Node in $FileData.nodes) {
            if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
            if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }

            foreach ($PA in $Node.graph_attributes.policy_actions) {
                $PolicyId = if ($PA.PSObject.Properties['policy_id']) { $PA.policy_id } else { $null }
                if (-not $PolicyId) {
                    $NodeIds.Add($Node.id)
                    break
                }
            }
        }
    }

    # No comma here: callers wrap this in @(...), per repo convention (t/3943
    # empirically re-discovered the t/3948 lesson one level removed -- a
    # comma-protected return PLUS an @() at the call site double-nests).
    return @($NodeIds | Select-Object -Unique)
}
