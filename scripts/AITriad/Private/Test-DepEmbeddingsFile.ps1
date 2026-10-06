# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepEmbeddingsFile {
    <#
    .SYNOPSIS
        embeddings.json presence + (test mode) staleness vs. the live taxonomy node count,
        for Invoke-DependencyCheck's section 6 (t/3910). Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][bool]$IsTestMode)

    $EmbFile = Get-TaxonomyDir 'embeddings.json'
    if (Test-Path $EmbFile) {
        try {
            $EmbData = Get-Content -Raw -Path $EmbFile | ConvertFrom-Json
            if ($EmbData.PSObject.Properties['node_count']) { $EmbCount = $EmbData.node_count } else { $EmbCount = '?' }
            Write-DepPass -Ctx $Ctx -Message "embeddings.json present ($EmbCount node embeddings)"

            # Test mode: check if embeddings are stale (more taxonomy nodes than embeddings)
            if ($IsTestMode -and $EmbCount -ne '?') {
                $TotalTaxNodes = 0
                foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'situations')) {
                    $E = $script:TaxonomyData[$PovKey]
                    if ($E) { $TotalTaxNodes += @($E.nodes).Count }
                }
                if ($TotalTaxNodes -gt [int]$EmbCount) {
                    Write-DepStale -Ctx $Ctx -Message "embeddings.json has $EmbCount embeddings but taxonomy has $TotalTaxNodes nodes — run Update-TaxEmbeddings"
                }
            }
        }
        catch {
            $EmbItem = Get-Item $EmbFile -ErrorAction SilentlyContinue
            if ($EmbItem -and $EmbItem -is [System.IO.FileInfo]) {
                $EmbSize = [Math]::Round($EmbItem.Length / 1MB, 1)
                Write-DepPass -Ctx $Ctx -Message "embeddings.json present (${EmbSize}MB)"
            }
            else { Write-DepWarn -Ctx $Ctx -Message "embeddings.json exists but could not be parsed" }
        }
    }
    else { Write-DepSkip -Message 'embeddings.json not yet generated — run Update-TaxEmbeddings' }
}
