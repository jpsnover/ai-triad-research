# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-SummariesInputHash {
    <#
    .SYNOPSIS
        Deterministic content fingerprint of a summaries corpus (t/3596/t/3598).
    .DESCRIPTION
        Single source of truth for the summaries input-hash. Build-NodeSourceIndex stores
        this in source_index.json's header; Test-CitationLinkIntegrity leg (c) recomputes it
        to detect a stale index. Both MUST use this one function so the gate can never drift
        from the builder.

        Algorithm (no wall-clock — SO cond 1): for each *.json under $SummariesDir, ordinal-
        sorted by file name, form "<name>`t<sha256(rawbytes)>"; the result is
        sha256(utf8(join(fileprints, "`n"))). Hex is lowercase 2-digit.
    .PARAMETER SummariesDir
        Directory of summary JSON files.
    .OUTPUTS
        [string] 64-char lowercase hex sha256.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$SummariesDir
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hex = { param([byte[]]$b) -join ($sha.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) }
        $fileprints = [System.Collections.Generic.List[string]]::new()
        foreach ($file in (Get-ChildItem -LiteralPath $SummariesDir -Filter '*.json' -File | Sort-Object Name)) {
            $raw = [System.IO.File]::ReadAllBytes($file.FullName)
            $fileprints.Add("$($file.Name)`t$(& $hex $raw)")
        }
        & $hex ([System.Text.Encoding]::UTF8.GetBytes(($fileprints -join "`n")))
    }
    finally { $sha.Dispose() }
}
