# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-NodeEmbeddingsCache {
    <#
    .SYNOPSIS
        Loads the cached node description embeddings from embeddings.json (t/3910 extraction
        from Get-TaxonomyHealthData). Returns $null (never throws) if the file is absent or
        fails to parse -- the caller treats $null as "node similarity check unavailable."
    .OUTPUTS
        [hashtable] node id -> double[] vector, or $null.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    Set-StrictMode -Version Latest

    $EmbPath = Join-Path (Get-TaxonomyDir) 'embeddings.json'
    if (-not (Test-Path $EmbPath)) { return $null }

    try {
        $EmbData = Get-Content -Raw -Path $EmbPath | ConvertFrom-Json
        $NodeEmbeddings = @{}
        $EmbNodes = if ($EmbData.PSObject.Properties['nodes']) { $EmbData.nodes } else { $null }
        if (-not $EmbNodes) { throw "embeddings.json has no 'nodes' field" }
        foreach ($Prop in $EmbNodes.PSObject.Properties) {
            $NodeEmbeddings[$Prop.Name] = [double[]]@($Prop.Value.vector)
        }
        return $NodeEmbeddings
    }
    catch {
        Write-Verbose "Get-TaxonomyHealthData: failed to load embeddings.json — skipping node similarity check"
        return $null
    }
}
