# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchDebateContext {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 5b (t/3910): map each contested taxonomy node to the
        titles of the debates whose harvest applied a debate_ref to it.
    .DESCRIPTION
        Reads every harvests/*.json manifest; an unreadable manifest is skipped (Verbose).
        Returns @{ <nodeId> = @(<debate title>, ...) }, empty when there are no harvests.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([Parameter(Mandatory)][string]$HarvestsDir)

    $DebateContext = @{}
    if (Test-Path $HarvestsDir) {
        foreach ($ManifestFile in (Get-ChildItem $HarvestsDir -Filter '*.json' -ErrorAction SilentlyContinue)) {
            try {
                $Manifest = Get-Content $ManifestFile.FullName -Raw | ConvertFrom-Json
                $DebateTitle = $Manifest.debate_title
                foreach ($Item in $Manifest.items) {
                    if ($Item.type -eq 'debate_ref' -and $Item.status -eq 'applied') {
                        $NodeId = $Item.id
                        if (-not $DebateContext.ContainsKey($NodeId)) { $DebateContext[$NodeId] = @() }
                        $DebateContext[$NodeId] += $DebateTitle
                    }
                }
            }
            catch {
                Write-Verbose "Skipping harvest manifest $($ManifestFile.Name): $_"
            }
        }
    }
    if ($DebateContext.Count -gt 0) {
        Write-Info "  Loaded debate context for $($DebateContext.Count) contested nodes"
    }
    return $DebateContext
}
