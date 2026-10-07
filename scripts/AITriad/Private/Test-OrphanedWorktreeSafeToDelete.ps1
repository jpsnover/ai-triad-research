# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-OrphanedWorktreeSafeToDelete {
    <#
    .SYNOPSIS
        Checks whether an orphaned worktree directory (t/3846) is safe to delete.
    .DESCRIPTION
        `Get-OrphanedWorktree` finds directories under `.worktrees/` that are present
        on disk but NOT registered in `git worktree list` -- the opposite of what
        `git worktree prune` cleans up (registered-but-missing directories), which is
        why `prune` is a no-op for them (t/3846).

        This performs the safety check named in t/3846 before advising manual
        deletion: a directory is safe to delete only if it has no `.git` file/dir
        (which would mean it's actually a real worktree root that merely failed to
        register -- deleting it would destroy a worktree, not build residue) and
        contains no files outside `node_modules/` (the known pollution source,
        t/2768/t/2769).
    .PARAMETER Path
        Full path to the orphaned directory to check.
    .OUTPUTS
        [PSCustomObject] with SafeToDelete (bool) and Reason (string).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    Set-StrictMode -Version Latest

    if (Test-Path (Join-Path $Path '.git')) {
        return [PSCustomObject]@{
            SafeToDelete = $false
            Reason       = '.git present -- this looks like a real worktree that failed to register, not build residue. Do not delete automatically; investigate with git worktree list / git worktree remove.'
        }
    }

    # Walk without descending into node_modules/ -- a full -Recurse enumerates every
    # package file and takes minutes per directory on Windows.
    $NonNodeModulesFiles = [System.Collections.Generic.List[string]]::new()
    $Pending = [System.Collections.Generic.Stack[string]]::new()
    $Pending.Push($Path)
    while ($Pending.Count -gt 0) {
        foreach ($Item in @(Get-ChildItem -LiteralPath $Pending.Pop() -Force -ErrorAction SilentlyContinue)) {
            if (-not $Item.PSIsContainer) { $NonNodeModulesFiles.Add($Item.FullName) }
            elseif ($Item.Name -ne 'node_modules') { $Pending.Push($Item.FullName) }
        }
    }
    if ($NonNodeModulesFiles.Count -gt 0) {
        return [PSCustomObject]@{
            SafeToDelete = $false
            Reason       = "Contains $($NonNodeModulesFiles.Count) file(s) outside node_modules/ -- inspect manually before deleting."
        }
    }

    return [PSCustomObject]@{
        SafeToDelete = $true
        Reason       = 'Only node_modules/ build residue, no .git marker.'
    }
}
