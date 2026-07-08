# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Embeds many texts in ONE embed_taxonomy.py subprocess (model loads once),
# instead of spawning a cold process per text. Returns a hashtable mapping the
# original text -> [double[]] vector. Distinct texts only are sent; blanks are
# skipped. On any failure returns an empty hashtable so callers fall back.
#
# This is the single-process, model-stays-warm path the per-call `encode -`
# spawns lacked: N texts cost one ~6s model load + N×ms, not N×6s.
#
# t/1404: Text longer than $MaxCharsPerChunk (default 900, safe margin under
# all-MiniLM-L6-v2's real 256-token / ~1000-char ceiling) is split into chunks
# via Split-TextIntoEmbeddingChunks, encoded per-chunk, then mean-pooled and
# re-normalized via Merge-EmbeddingChunks so content past the first chunk
# actually influences the returned vector. Previous behavior hard-truncated at
# 1000 chars, silently discarding everything past the boundary — noticeable
# to Get-RelevantTaxonomyNodes for chunk-length RAG queries.
function Invoke-BatchEmbeddings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Texts,
        [ValidateRange(200, 1000)][int]$MaxCharsPerChunk = 900
    )

    Set-StrictMode -Version Latest
    $Result = @{}

    $Distinct = @($Texts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if ($Distinct.Count -eq 0) { return $Result }

    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (-not (Test-Path $EmbedScript)) { return $Result }
    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Build chunk-level payload with structured IDs "origIdx::chunkN" so we can
    # group vectors back after encoding (t/1404).
    $Chunks  = [System.Collections.Generic.List[object]]::new()
    $ChunkGroups = @{}   # "origIdx" -> chunk count
    $IdxToText   = @{}   # "origIdx" -> full original text (for caller-facing map)
    for ($i = 0; $i -lt $Distinct.Count; $i++) {
        $Full = $Distinct[$i]
        $Key  = "$i"
        $IdxToText[$Key] = $Full
        $Pieces = Split-TextIntoEmbeddingChunks -Text $Full -MaxCharsPerChunk $MaxCharsPerChunk
        for ($k = 0; $k -lt $Pieces.Count; $k++) {
            $Chunks.Add([ordered]@{ id = "${Key}::$k"; text = $Pieces[$k] })
        }
        $ChunkGroups[$Key] = $Pieces.Count
    }

    if ($Chunks.Count -eq 0) { return $Result }

    # ConvertTo-Json collapses a single-element array to a bare object; force an
    # array so embed_taxonomy.py batch-encode always receives a JSON list.
    $Payload = @($Chunks) | ConvertTo-Json -Depth 3 -Compress
    if ($Chunks.Count -eq 1) { $Payload = "[$Payload]" }

    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $PrevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $Output = $Payload | & $PythonCmd $EmbedScript batch-encode 2>$null
    } finally {
        $ErrorActionPreference = $PrevEAP
    }
    $Sw.Stop()
    Add-StageTiming -Name 'embed.subprocess (batch)' -Milliseconds $Sw.Elapsed.TotalMilliseconds

    if ($LASTEXITCODE -ne 0 -or -not $Output) { return $Result }

    try { $ParsedHt = $Output | ConvertFrom-Json -AsHashtable } catch { return $Result }

    # Mean-pool + re-normalize per original index, then remap back to the
    # caller-facing text -> vector shape.
    $Ids = [string[]]@(0..($Distinct.Count - 1) | ForEach-Object { $_.ToString() })
    $Pooled = Merge-EmbeddingChunks -Ids $Ids -ChunkGroups $ChunkGroups -ChunkVectors $ParsedHt
    foreach ($Key in $Pooled.Keys) {
        $Vec = $Pooled[$Key]
        if ($null -eq $Vec -or @($Vec).Count -eq 0) { continue }
        $OrigText = $IdxToText[$Key]
        if ($OrigText) { $Result[$OrigText] = $Vec }
    }
    return $Result
}
