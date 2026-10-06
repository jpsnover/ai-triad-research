# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSBOMSpdx {
    <#
    .SYNOPSIS
        Renders the full SPDX-2.3 JSON document for the SBOM entries.
        Extracted verbatim from Get-AITSBOM's -Format SPDX branch (t/3910)
        -- no behavior change.
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

    $Packages = @($Entries | ForEach-Object { ConvertTo-AITSBOMSpdxPackage -Entry $_ })

    $SPDX = [ordered]@{
        spdxVersion       = 'SPDX-2.3'
        dataLicense       = 'CC0-1.0'
        SPDXID            = 'SPDXRef-DOCUMENT'
        name              = 'ai-triad-research-sbom'
        documentNamespace = "https://spdx.org/spdxdocs/ai-triad-research-$(New-Guid)"
        creationInfo      = [ordered]@{
            created  = (Get-Date).ToString('o')
            creators = @('Tool: Get-AITSBOM')
        }
        packages          = $Packages
    }

    return ($SPDX | ConvertTo-Json -Depth 10)
}
