# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Generates a unique doc-id by appending year + optional numeric suffix.

function Resolve-DocId {
    param(
        [string]$BaseSlug,
        [string]$Year = (Get-Date -Format 'yyyy')
    )

    $SourcesDir = Get-SourcesDir
    if (-not (Test-Path $SourcesDir)) {
        Write-Warning "Sources directory not found: $SourcesDir — uniqueness check skipped"
    }
    $Candidate  = "$BaseSlug-$Year"
    $Counter    = 1
    while (Test-Path (Join-Path $SourcesDir $Candidate)) {
        $Candidate = "$BaseSlug-$Year-$Counter"
        $Counter++
    }
    return $Candidate
}
