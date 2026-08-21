# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Write-Utf8NoBom {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Path,

        [Parameter(Mandatory=$true, ValueFromPipeline=$true, Position=1)]
        [AllowEmptyString()]
        $Value,

        [switch]$NoNewline,
        [switch]$Force,

        # t/2902 — force a HARD block regardless of guard mode/scope (Part 1
        # semantics): assert the target is clean and throw on dirty. Prefer letting
        # the centralized guard (below) decide; this is the explicit caller opt-in.
        [switch]$RequireCleanTree,

        # t/2902 — opt a legitimate sequential rewriter out of the dirty-tree guard
        # (a target intentionally left dirty by a prior pass in the same run).
        [switch]$AllowDirty
    )
    begin {
        $parts = New-Object System.Collections.Generic.List[string]
    }
    process {
        if ($null -ne $Value) {
            if ($Value -is [array]) {
                foreach ($item in $Value) { $parts.Add([string]$item) }
            } else {
                $parts.Add([string]$Value)
            }
        }
    }
    end {
        $text = ($parts -join "`n") -replace "`r`n", "`n"
        if (-not $NoNewline -and $text.Length -gt 0 -and $text[$text.Length - 1] -ne "`n") {
            $text += "`n"
        }
        $dir = Split-Path -Path $Path -Parent
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        $fileName = Split-Path -Path $Path -Leaf
        if ($fileName -match '^(accelerationist|safetyist|skeptic|situations)\.json$' -and $text.Length -gt 10MB) {
            Write-Warning "Write-Utf8NoBom: BLOCKED write to $fileName — content is $([math]::Round($text.Length / 1MB, 1)) MB (likely corrupted). This prevents a runaway encoding bug."
            return
        }
        # t/2902 — centralized dirty-tree-sweep guard. Every content-string data
        # write funnels through here, so guarding this sink covers all such callers
        # (current and future) without per-callsite wiring. The guard fires only for
        # a target UNDER the data root that is ALREADY dirty (Warn-first by default,
        # Block after promotion). -RequireCleanTree forces a hard block regardless of
        # mode/scope (Part 1); -AllowDirty opts a legit sequential rewriter out.
        if ($RequireCleanTree) {
            if (-not $AllowDirty) { Assert-CleanDataTree -Path $Path }
        }
        else {
            Assert-DataWriteAllowed -Path $Path -AllowDirty:$AllowDirty
        }
        Set-Content -Path $Path -Value $text -Encoding utf8NoBOM -NoNewline
    }
}
