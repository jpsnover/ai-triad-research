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

        Algorithm (no wall-clock — SO cond 1; hashes LOGICAL content, not raw bytes — CL-ratified
        predicate fix, t/3745#8 / p/23#452): for each *.json under $SummariesDir, **ordinally**
        sorted by file name ([string]::CompareOrdinal — never culture-aware Sort-Object, root
        AGENTS.md), form "<name>`t<sha256(canonical bytes)>" where canonical bytes are the
        file's text — UTF-8 decoded with any BOM stripped, then CRLF/CR line endings normalized
        to LF — re-encoded UTF-8 (no BOM). Without this normalization the SAME summaries content
        hashes differently depending on whether the working tree checked the files out with CRLF
        (Windows) or LF (Linux/CI) line endings — a real bug found when leg (c) false-failed in
        CI on a corpus the citation-integrity PR never touched (t/3745#8): the stored index was
        built on a CRLF checkout (`d9f40d75…`), CI recomputed on an LF checkout (`131beb54…`),
        and the digests differed despite byte-identical *content*, confirmed by CL as zero
        summaries changed after the index build. The result is sha256(utf8(join(fileprints,
        "`n"))). Hex is lowercase 2-digit.
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
        $files = @(Get-ChildItem -LiteralPath $SummariesDir -Filter '*.json' -File)
        [System.Array]::Sort($files, [System.Comparison[System.IO.FileInfo]] {
            param($a, $b) [string]::CompareOrdinal($a.Name, $b.Name)
        })
        $fileprints = [System.Collections.Generic.List[string]]::new()
        foreach ($file in $files) {
            # StreamReader with detectEncodingFromByteOrderMarks:$true strips a UTF-8 BOM if
            # present (CL-ratified predicate step, p/23#452/#453) regardless of the declared
            # encoding; normalize line endings BEFORE re-encoding, so a CRLF (Windows) checkout
            # and an LF (Linux/CI) checkout of byte-identical logical content hash to the same
            # digest (t/3745#8 — raw-byte hashing was platform-dependent).
            $reader = [System.IO.StreamReader]::new($file.FullName, [System.Text.Encoding]::UTF8, $true)
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $canonical = $text -replace "`r`n", "`n" -replace "`r", "`n"
            $canonicalBytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
            $fileprints.Add("$($file.Name)`t$(& $hex $canonicalBytes)")
        }
        & $hex ([System.Text.Encoding]::UTF8.GetBytes(($fileprints -join "`n")))
    }
    finally { $sha.Dispose() }
}
