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

    all-MiniLM-L6-v2 has a real context window of 256 word-piece tokens
    (~900-1000 English chars). Text longer than that is split into chunks
    of at most `-MaxCharsPerChunk` (default 900, safe margin under the
    ~1000-char/256-token ceiling), encoded in a single Python subprocess,
    then mean-pooled and re-normalized in PS — so content past the first
    chunk boundary actually influences the returned vector (t/1404).

    Returns $null if Python or sentence-transformers is unavailable.
.PARAMETER Texts
    Array of text strings to embed.
.PARAMETER Ids
    Optional array of IDs corresponding to each text. If omitted, uses
    zero-based indices as IDs.
.PARAMETER MaxCharsPerChunk
    Maximum characters per chunk before word-boundary aware splitting.
    Default 900 (safe margin under the 256-token / ~1000-char ceiling).
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

        [string[]]$Ids,

        [ValidateRange(200, 1000)]
        [int]$MaxCharsPerChunk = 900
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

    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (-not (Test-Path $EmbedScript)) {
        Write-Verbose "Get-TextEmbedding: embed_taxonomy.py not found at $EmbedScript"
        return $null
    }

    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Split each input into chunks that fit inside the model's real context window
    # (t/1404). Chunk IDs are "origId::chunkN" so we can group them back after encoding.
    $Chunks = [System.Collections.Generic.List[object]]::new()
    $ChunkGroups = @{}  # origId -> int (chunk count)
    for ($i = 0; $i -lt $Texts.Count; $i++) {
        $OrigId = $Ids[$i]
        $Text = $Texts[$i]
        if ([string]::IsNullOrEmpty($Text)) {
            $ChunkGroups[$OrigId] = 0
            continue
        }
        $Pieces = Split-TextIntoEmbeddingChunks -Text $Text -MaxCharsPerChunk $MaxCharsPerChunk
        for ($k = 0; $k -lt $Pieces.Count; $k++) {
            $Chunks.Add([ordered]@{ id = "${OrigId}::$k"; text = $Pieces[$k] })
        }
        $ChunkGroups[$OrigId] = $Pieces.Count
    }

    if ($Chunks.Count -eq 0) {
        # All inputs were empty
        $Result = @{}
        foreach ($OrigId in $Ids) { $Result[$OrigId] = [double[]]@() }
        return $Result
    }

    $InputJson = @($Chunks) | ConvertTo-Json -Depth 5 -Compress
    # ConvertTo-Json collapses a single-element array to a bare object — force a list.
    if ($Chunks.Count -eq 1) { $InputJson = "[$InputJson]" }

    try {
        # PS 5.1: native stderr becomes terminating error under $ErrorActionPreference='Stop'
        $PrevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $Output = $InputJson | & $PythonCmd $EmbedScript batch-encode 2>$null } finally { $ErrorActionPreference = $PrevEAP }
        if ($LASTEXITCODE -ne 0) {
            Write-Verbose "Get-TextEmbedding: batch-encode failed (exit code $LASTEXITCODE)"
            return $null
        }

        $Parsed = $Output | ConvertFrom-Json -AsHashtable
        return Merge-EmbeddingChunks -Ids $Ids -ChunkGroups $ChunkGroups -ChunkVectors $Parsed
    }
    catch {
        Write-Verbose "Get-TextEmbedding: $($_.Exception.Message)"
        return $null
    }
}
