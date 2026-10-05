# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-AIUsageFiles {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): resolves which usage-summary.jsonl
        file(s) to read.
    .PARAMETER Path
        Path to a usage-summary.jsonl file or directory containing them. Empty
        string triggers the default search (repo-root debates/, then data-root
        debates/).
    .OUTPUTS
        [System.IO.FileInfo[]]
    #>
    [CmdletBinding()]
    [OutputType([System.IO.FileInfo[]])]
    param(
        [string]$Path = ''
    )

    Set-StrictMode -Version Latest

    if ($Path -and (Test-Path $Path)) {
        if ((Get-Item $Path).PSIsContainer) {
            return @(Get-ChildItem -Path $Path -Filter 'usage-summary.jsonl' -Recurse)
        }
        return @(Get-Item $Path)
    }

    $SearchDirs = @(
        (Join-Path $script:RepoRoot 'debates')
    )
    try { $SearchDirs += Join-Path (Get-DataRoot) 'debates' } catch { }

    foreach ($Dir in $SearchDirs) {
        if (Test-Path $Dir) {
            $Found = @(Get-ChildItem -Path $Dir -Filter 'usage-summary.jsonl' -Recurse)
            if ($Found.Count -gt 0) { return $Found }
        }
    }

    return @()
}
