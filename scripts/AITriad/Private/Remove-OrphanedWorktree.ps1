# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Remove-OrphanedWorktree {
    <#
    .SYNOPSIS
        Deletes an orphaned worktree directory in a detached background process.
    .DESCRIPTION
        Removing a worktree on Windows routinely leaves its node_modules/ trees behind
        (locked .node files, AV, the 2-minute tool cap on a synchronous rm -- Sage
        lesson #78), so residue accumulates under .worktrees/ faster than anyone
        deletes it by hand. Callers gate this on Test-OrphanedWorktreeSafeToDelete;
        this function does not re-check.

        The delete runs detached because unlinking tens of thousands of small files is
        slow on Windows and must not delay the caller (e.g. app startup). On Windows it
        uses `rmdir /s /q`, which removes directory junctions without following them,
        so a junction into another tree's node_modules cannot take that tree with it.
    .PARAMETER Path
        Full path of the orphaned directory. Must sit directly under a `.worktrees`
        directory -- anything else is refused.
    .OUTPUTS
        [bool] $true when the background delete was started.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    Set-StrictMode -Version Latest

    $Full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $Parent = Split-Path $Full -Parent
    if ((Split-Path $Parent -Leaf) -ne '.worktrees') {
        Write-Warning "Remove-OrphanedWorktree: refusing '$Full' -- not directly under a .worktrees directory."
        return $false
    }
    if (-not (Test-Path -LiteralPath $Full -PathType Container)) { return $false }
    if (-not $PSCmdlet.ShouldProcess($Full, 'Delete orphaned worktree residue in background')) { return $false }

    try {
        if ($IsWindows) {
            Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', "rmdir /s /q `"$Full`"" -WindowStyle Hidden -ErrorAction Stop | Out-Null
        }
        else {
            Start-Process -FilePath 'rm' -ArgumentList '-rf', '--', $Full -ErrorAction Stop | Out-Null
        }
        return $true
    }
    catch {
        Write-Warning "Remove-OrphanedWorktree: background delete of '$Full' could not start ($($_.Exception.Message)); falling back to manual removal. Run: Remove-Item -Recurse -Force '$Full'"
        return $false
    }
}
