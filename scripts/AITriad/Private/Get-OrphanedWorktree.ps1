# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-OrphanedWorktree {
    <#
    .SYNOPSIS
        List directories under <RepoRoot>/.worktrees that are NOT registered git
        worktrees (orphans).
    .DESCRIPTION
        A leftover directory in `.worktrees/` that `git worktree list` no longer knows
        about (e.g. removed without `git worktree remove`, or pruned metadata) still
        sits on disk and can pollute node_modules resolution for `npm run dev`, surfacing
        as TS errors that look like source bugs (t/2768/t/2769). This returns the full
        paths of such orphans so callers can warn (non-blocking).

        Registered-worktree paths come from `git worktree list --porcelain`; both sides
        are normalized via [IO.Path]::GetFullPath and compared case-insensitively so
        the forward-slash paths git emits match the on-disk entries.
    .PARAMETER RepoRoot
        Repository root containing the `.worktrees/` directory.
    .OUTPUTS
        [string[]] full paths of orphaned worktree directories (empty when none / no
        .worktrees dir / git unavailable).
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    Set-StrictMode -Version Latest

    $wtDir = Join-Path $RepoRoot '.worktrees'
    if (-not (Test-Path $wtDir)) { return @() }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return @() }

    $norm = { param([string]$p) if ([string]::IsNullOrWhiteSpace($p)) { '' } else { ([System.IO.Path]::GetFullPath($p)).TrimEnd('\', '/') } }

    $registered = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $listOut = & git -C $RepoRoot worktree list --porcelain 2>$null
    foreach ($line in @($listOut)) {
        if ("$line" -match '^worktree\s+(.+)$') {
            [void]$registered.Add((& $norm $Matches[1]))
        }
    }

    $orphans = [System.Collections.Generic.List[string]]::new()
    foreach ($dir in @(Get-ChildItem -Path $wtDir -Directory -ErrorAction SilentlyContinue)) {
        if (-not $registered.Contains((& $norm $dir.FullName))) {
            $orphans.Add($dir.FullName)
        }
    }

    return $orphans.ToArray()
}
