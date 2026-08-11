# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Scheduled drift check for the fleet's shared main checkout (t/2452).
.DESCRIPTION
    Checks the shared main checkout for: commits behind origin/main, uncommitted
    tracked files (classified as 0-diff-safe or real WIP), 0-byte untracked junk
    files, and non-0-byte extension-less untracked files in source directories
    (t/2222 spray pattern + t/2473 extension; excluding linked worktrees).

    Contract (TL-approved, t/2452#4):
      - WARN-ONLY: always exits 0; git failures are best-effort skips.
      - SILENT on a clean + current tree (Alarm=$false, no output beyond the object).
      - Returns a PSCustomObject for the calling agent to interpret and ping on.
      - Cadence: 60 min (hourly backstop via Orca reminder; proportionate given the
        dev-start hook in check-drift.cjs already covers the acute at-dev-time case).

    Seeded-arm proofs must use a disposable clone (-RepoRoot <clone>), NOT the live
    shared tree. Only the clean arm runs against the real checkout.
.PARAMETER RepoRoot
    Absolute path to the shared main checkout. Defaults to the standard fleet path.
    Pass a disposable clone path when running proof/test arms.
#>

param(
    [string]$RepoRoot = 'C:\Users\jsnov\repos\ai-triad-research'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

function Invoke-Git {
    param([string[]]$GitArgs, [int]$TimeoutMs = 5000)
    try {
        $job = Start-Job { & git @using:GitArgs 2>$null }
        $completed = Wait-Job $job -Timeout ([int]($TimeoutMs / 1000))
        if (-not $completed) { Remove-Job $job -Force; return $null }
        $out = Receive-Job $job
        Remove-Job $job
        return $out
    } catch { return $null }
}

$result = [PSCustomObject]@{
    Alarm            = $false
    BehindCount      = 0
    DirtyFiles       = @()
    HasRealDiff      = $false
    JunkPaths        = @()
    SuspiciousPaths  = @()
    RemediationHint  = ''
}

try {
    # 1. Fetch (best-effort; skip on failure — we compare against last-fetched ref)
    Invoke-Git @('-C', $RepoRoot, 'fetch', '--quiet', 'origin', 'main') | Out-Null

    # 2. Behind count
    $behindRaw = Invoke-Git @('-C', $RepoRoot, 'rev-list', '--count', 'HEAD..origin/main')
    $behind = if ($behindRaw -match '^\d+$') { [int]$behindRaw } else { 0 }
    $result.BehindCount = $behind

    # 3. Dirty tracked files (tracked only — untracked handled separately)
    $statusOut = Invoke-Git @('-C', $RepoRoot, 'status', '--porcelain', '--untracked-files=no')
    $dirtyFiles = @($statusOut | Where-Object { $_ } | ForEach-Object { $_.Substring(3).Trim() })
    $result.DirtyFiles = $dirtyFiles

    # 4. Classify each dirty file: 0-diff vs real WIP
    $hasRealDiff = $false
    foreach ($f in $dirtyFiles) {
        $diff = Invoke-Git @('-C', $RepoRoot, 'diff', 'origin/main', '--', $f)
        if ($diff) { $hasRealDiff = $true; break }
    }
    $result.HasRealDiff = $hasRealDiff

    # 5. Junk untracked — two classes (t/2222 + t/2473), excluding linked worktrees (.worktrees/):
    #    JunkPaths:       0-byte files anywhere in the tree
    #    SuspiciousPaths: non-0-byte, extension-less files inside source directories
    #                     (shell-quoting debris like src/server/community/22)
    $untracked = @(Invoke-Git @('-C', $RepoRoot, 'ls-files', '--others', '--exclude-standard') | Where-Object { $_ })
    $sourceDirs = @('taxonomy-editor/src/', 'taxonomy-editor/lib/', 'lib/', 'engineering/', 'operations/', 'research/')
    $junkPaths = @()
    $suspiciousPaths = @()
    foreach ($f in $untracked) {
        # Skip anything under .worktrees/ — other agents' in-worktree files are not shared-tree drift
        if ($f -match '^\.worktrees[\\/]') { continue }
        $fullPath = Join-Path $RepoRoot $f
        try {
            $item = Get-Item $fullPath -ErrorAction Stop
            if ($item.Length -eq 0) {
                $junkPaths += $f
            } else {
                # Non-0-byte: flag if extension-less file found under a source directory
                $normalizedF = $f -replace '\\', '/'
                $inSourceDir = @($sourceDirs | Where-Object { $normalizedF.StartsWith($_) })
                $hasNoExtension = [System.IO.Path]::GetExtension($item.Name) -eq ''
                if ($inSourceDir.Count -gt 0 -and $hasNoExtension) { $suspiciousPaths += $f }
            }
        } catch { continue }
    }
    $result.JunkPaths = $junkPaths
    $result.SuspiciousPaths = $suspiciousPaths

    # 6. Determine alarm + remediation hint
    $alarm = $behind -gt 0 -or $dirtyFiles.Count -gt 0 -or $junkPaths.Count -gt 0 -or $suspiciousPaths.Count -gt 0
    $result.Alarm = $alarm

    if ($alarm) {
        $hints = @()
        if ($behind -gt 0) {
            $hints += "behind ($behind commit(s)): git fetch && git merge --ff-only origin/main"
        }
        if ($junkPaths.Count -gt 0) {
            $listed = $junkPaths -join ', '
            $hints += "junk 0-byte file(s) [$listed]: Remove-Item <paths>"
        }
        if ($suspiciousPaths.Count -gt 0) {
            $listed = $suspiciousPaths -join ', '
            $hints += "suspicious extension-less file(s) in source dir [$listed]: verify untracked, then Remove-Item <paths>"
        }
        if ($dirtyFiles.Count -gt 0) {
            if (-not $hasRealDiff) {
                $listed = $dirtyFiles -join ', '
                $hints += "dirty tracked (0-diff, safe to drop) [$listed]: git checkout -- <files>"
            } else {
                $listed = $dirtyFiles -join ', '
                $hints += "dirty tracked with REAL DIFF (WIP) [$listed]: snapshot-first + owner-claim required — do NOT stash or auto-merge; escalate to TL"
            }
        }
        $result.RemediationHint = $hints -join ' | '
    }
} catch {
    # Catch-all — never let the guard throw to the calling agent session
}

return $result
