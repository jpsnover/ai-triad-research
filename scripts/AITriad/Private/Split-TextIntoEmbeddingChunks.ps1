# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Splits a string into chunks of at most $MaxCharsPerChunk characters,
    aligning to the nearest whitespace boundary where possible so a chunk
    doesn't end mid-word (t/1404).
.DESCRIPTION
    Used by Get-TextEmbedding and Invoke-BatchEmbeddings to keep each
    encoded chunk under all-MiniLM-L6-v2's real 256-token / ~1000-char
    context window while still letting content past the boundary
    influence the caller-visible mean-pooled vector.

    Returns the input as a single element when the input is <= MaxCharsPerChunk;
    otherwise walks forward, looking back up to 80 chars from each hard
    boundary for the last whitespace, and cuts there.
#>
function Split-TextIntoEmbeddingChunks {
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [ValidateRange(200, 1000)][int]$MaxCharsPerChunk = 900
    )

    if ([string]::IsNullOrEmpty($Text) -or $Text.Length -le $MaxCharsPerChunk) {
        return , @($Text)
    }

    $Pieces = [System.Collections.Generic.List[string]]::new()
    $Pos = 0
    $LookBackWindow = 80
    $Whitespace = [char[]]@(' ', "`t", "`n", "`r")

    while ($Pos -lt $Text.Length) {
        $HardEnd = [Math]::Min($Pos + $MaxCharsPerChunk, $Text.Length)
        $CutEnd = $HardEnd
        if ($HardEnd -lt $Text.Length) {
            # Look back for a word boundary within the last N chars of this chunk
            $LookBack = [Math]::Min($LookBackWindow, $HardEnd - $Pos)
            $BoundaryIdx = $Text.LastIndexOfAny($Whitespace, $HardEnd - 1, $LookBack)
            if ($BoundaryIdx -gt $Pos) { $CutEnd = $BoundaryIdx + 1 }
        }
        $Pieces.Add($Text.Substring($Pos, $CutEnd - $Pos))
        $Pos = $CutEnd
    }

    return , [string[]]$Pieces
}
