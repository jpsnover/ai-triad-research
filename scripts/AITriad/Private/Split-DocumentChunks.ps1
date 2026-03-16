# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Splits a Markdown document into semantically coherent chunks for parallel summarization.
# Prefers splitting on heading boundaries; falls back to paragraph breaks for oversized sections.

function Split-DocumentChunks {
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Text,
        [int]$MaxChunkTokens = 15000,
        [int]$MinChunkTokens = 2000
    )

    Set-StrictMode -Version Latest

    # Rough token estimation: 1 token ≈ 4 characters
    function Est-Tokens([string]$s) { [int]($s.Length / 4) }

    $TotalTokens = Est-Tokens $Text

    # If the document fits in a single chunk, return it as-is
    if ($TotalTokens -le $MaxChunkTokens) {
        return @($Text)
    }

    # ── Phase 1: Split on Markdown headings (##, ###, ####) ──────────────────
    # Keep the heading with the section that follows it
    $HeadingPattern = '(?m)^(?=#{2,4}\s)'
    $Sections = @([regex]::Split($Text, $HeadingPattern) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

    if ($Sections.Count -le 1) {
        # No headings found — split on double-newlines (paragraph breaks)
        $Sections = @($Text -split '(?:\r?\n){2,}' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    # ── Phase 2: Pack sections into chunks up to MaxChunkTokens ──────────────
    $Chunks = [System.Collections.Generic.List[string]]::new()
    $CurrentChunk = [System.Text.StringBuilder]::new()
    $CurrentTokens = 0

    foreach ($Section in $Sections) {
        $SectionTokens = Est-Tokens $Section

        # If a single section exceeds max, split it further on paragraph breaks
        if ($SectionTokens -gt $MaxChunkTokens) {
            # Flush current accumulator first
            if ($CurrentTokens -gt 0) {
                $Chunks.Add($CurrentChunk.ToString().Trim())
                $CurrentChunk = [System.Text.StringBuilder]::new()
                $CurrentTokens = 0
            }

            # Sub-split this large section on paragraph breaks
            $Paragraphs = @($Section -split '(?:\r?\n){2,}' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            $SubChunk = [System.Text.StringBuilder]::new()
            $SubTokens = 0

            foreach ($Para in $Paragraphs) {
                $ParaTokens = Est-Tokens $Para

                if ($SubTokens + $ParaTokens -gt $MaxChunkTokens -and $SubTokens -gt 0) {
                    $Chunks.Add($SubChunk.ToString().Trim())
                    $SubChunk = [System.Text.StringBuilder]::new()
                    $SubTokens = 0
                }

                [void]$SubChunk.AppendLine($Para)
                [void]$SubChunk.AppendLine()
                $SubTokens += $ParaTokens
            }

            if ($SubTokens -gt 0) {
                $Chunks.Add($SubChunk.ToString().Trim())
            }
            continue
        }

        # Would adding this section exceed the limit?
        if ($CurrentTokens + $SectionTokens -gt $MaxChunkTokens -and $CurrentTokens -gt 0) {
            $Chunks.Add($CurrentChunk.ToString().Trim())
            $CurrentChunk = [System.Text.StringBuilder]::new()
            $CurrentTokens = 0
        }

        [void]$CurrentChunk.AppendLine($Section)
        [void]$CurrentChunk.AppendLine()
        $CurrentTokens += $SectionTokens
    }

    # Flush the last accumulator
    if ($CurrentTokens -gt 0) {
        $Chunks.Add($CurrentChunk.ToString().Trim())
    }

    # ── Phase 3: Merge tiny trailing chunks into the previous one ────────────
    if ($Chunks.Count -gt 1) {
        $Merged = [System.Collections.Generic.List[string]]::new()
        for ($i = 0; $i -lt $Chunks.Count; $i++) {
            $ChunkTokens = Est-Tokens $Chunks[$i]

            if ($ChunkTokens -lt $MinChunkTokens -and $Merged.Count -gt 0) {
                # Merge into the previous chunk
                $Prev = $Merged[$Merged.Count - 1]
                $Merged[$Merged.Count - 1] = "$Prev`n`n$($Chunks[$i])"
            } else {
                $Merged.Add($Chunks[$i])
            }
        }
        return @($Merged)
    }

    return @($Chunks)
}
