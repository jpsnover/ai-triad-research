# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSBOMCycloneDX {
    <#
    .SYNOPSIS
        Renders the full CycloneDX 1.5 JSON document for the SBOM entries.
        Extracted verbatim from Get-AITSBOM's -Format CycloneDX branch
        (t/3910) -- no behavior change.
    .PARAMETER Entries
        The full SBOM entries list.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.List[PSObject]]$Entries
    )

    Set-StrictMode -Version Latest

    $ManifestPath = Join-Path $script:ModuleRoot 'AITriad.psd1'
    $Components = @($Entries | ForEach-Object { ConvertTo-AITSBOMCycloneDXComponent -Entry $_ })

    $CycloneDX = [ordered]@{
        bomFormat   = 'CycloneDX'
        specVersion = '1.5'
        version     = 1
        metadata    = [ordered]@{
            timestamp = (Get-Date).ToString('o')
            component = [ordered]@{
                type    = 'application'
                name    = 'ai-triad-research'
                version = (Import-PowerShellDataFile -Path $ManifestPath).ModuleVersion
            }
        }
        components  = $Components
    }

    return ($CycloneDX | ConvertTo-Json -Depth 10)
}
