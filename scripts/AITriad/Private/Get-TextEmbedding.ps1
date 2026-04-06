# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Computes semantic embeddings for one or more text strings using the local
    all-MiniLM-L6-v2 model (384-dimensional vectors, no API key required).
.DESCRIPTION
    Wraps embed_taxonomy.py batch-encode to embed arbitrary text strings.
    Uses the same model and normalization as the cached taxonomy embeddings,
    so cosine similarities are directly comparable.

    Returns a hashtable mapping each input ID to its embedding vector.
    Texts are truncated to 2000 chars (model context limit).
.PARAMETER Texts
    Array of text strings to embed.
.PARAMETER Ids
    Optional array of IDs corresponding to each text. If omitted, uses
    zero-based indices as IDs.
.OUTPUTS
    [hashtable] — keys are IDs (or indices), values are [double[]] vectors.
    Returns $null if Python or sentence-transformers is unavailable.
.EXAMPLE
    $emb = Get-TextEmbedding -Texts @('AI governance framework', 'Governance frameworks for AI')
    # $emb['0'] and $emb['1'] are 384-dimensional vectors
.EXAMPLE
    $emb = Get-TextEmbedding -Texts $concepts.Description -Ids $concepts.Id
    # $emb['uc-1'], $emb['uc-2'], etc.
#>
function Get-TextEmbedding {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$Texts,

        [string[]]$Ids
    )

    Set-StrictMode -Version Latest

    if ($Texts.Count -eq 0) { return @{} }

    # Default IDs to zero-based indices
    if (-not $Ids -or $Ids.Count -eq 0) {
        $Ids = 0..($Texts.Count - 1) | ForEach-Object { $_.ToString() }
    }

    if ($Ids.Count -ne $Texts.Count) {
        Write-Error "Get-TextEmbedding: Ids count ($($Ids.Count)) must match Texts count ($($Texts.Count))"
        return $null
    }

    $EmbedScript = Join-Path (Join-Path $script:ModuleRoot '..') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) {
        Write-Verbose "Get-TextEmbedding: embed_taxonomy.py not found at $EmbedScript"
        return $null
    }

    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Build batch-encode input: [{"id": "...", "text": "..."}]
    $Items = for ($i = 0; $i -lt $Texts.Count; $i++) {
        if ($Texts[$i].Length -gt 2000) { $Trunc = $Texts[$i].Substring(0, 2000) } else { $Trunc = $Texts[$i] }
        [ordered]@{ id = $Ids[$i]; text = $Trunc }
    }
    $InputJson = @($Items) | ConvertTo-Json -Depth 5 -Compress

    try {
        $Output = $InputJson | & $PythonCmd $EmbedScript batch-encode 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Verbose "Get-TextEmbedding: batch-encode failed (exit code $LASTEXITCODE)"
            return $null
        }

        $Parsed = $Output | ConvertFrom-Json | ConvertTo-Hashtable
        # Convert arrays to [double[]] for cosine computation
        $Result = @{}
        foreach ($Key in $Parsed.Keys) {
            $Result[$Key] = [double[]]@($Parsed[$Key])
        }
        return $Result
    }
    catch {
        Write-Verbose "Get-TextEmbedding: $($_.Exception.Message)"
        return $null
    }
}
