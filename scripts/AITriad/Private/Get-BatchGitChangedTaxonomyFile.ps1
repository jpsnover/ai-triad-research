# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-BatchGitChangedTaxonomyFile {
    <#
    .SYNOPSIS
        The git half of Invoke-BatchSummary STEP 2 (t/3910): POV taxonomy files changed
        between the last two commits that touched TAXONOMY_VERSION.
    .DESCRIPTION
        Falls back to every file (with a WARN) when git is missing or the diff fails, and
        to every file when there is no previous version commit. Names outside the POV map
        are ignored. May return duplicates; the caller de-duplicates.
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$PovFileMap,
        [Parameter(Mandatory)][string]$RepoRoot
    )

    if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Warn "git not found — falling back to ForceAll mode"
        return @($PovFileMap.Keys)
    }

    $Changed = @()
    try {
        Push-Location $RepoRoot

        $VersionCommits = @(git log --pretty=format:"%H" -- TAXONOMY_VERSION 2>$null |
                            Select-Object -First 2)

        if ($VersionCommits.Count -ge 2) {
            $PrevCommit = $VersionCommits[1]
            $CurrCommit = $VersionCommits[0]

            $GitDiffOutput = git diff --name-only "${PrevCommit}..${CurrCommit}" -- taxonomy/Origin/ 2>$null
            Write-Info "Git diff range: $($PrevCommit.Substring(0,8))...$($CurrCommit.Substring(0,8))"
        } else {
            Write-Info "No previous version commit found; treating all files as changed"
            $GitDiffOutput = $PovFileMap.Keys | ForEach-Object { "taxonomy/Origin/$_" }
        }

        foreach ($ChangedPath in $GitDiffOutput) {
            $ChangedFile = Split-Path $ChangedPath -Leaf
            if ($PovFileMap.Contains($ChangedFile)) { $Changed += $ChangedFile }
        }
    } catch {
        Write-Warn "git diff failed: $_ — falling back to ForceAll mode"
        $Changed = @($PovFileMap.Keys)
    } finally {
        Pop-Location
    }
    return $Changed
}
