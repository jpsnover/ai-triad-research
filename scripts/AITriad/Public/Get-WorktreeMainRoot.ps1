# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-WorktreeMainRoot {
    <#
    .SYNOPSIS
        Resolves the true main-checkout root for the git worktree containing -Path (t/3869).
    .DESCRIPTION
        $script:RepoRoot (module-load-time $PSScriptRoot/../..) always resolves to the
        CURRENT worktree's own root -- correct for code-repo-relative paths, since every
        worktree carries its own checkout of lib/, scripts/, ai-models.json, etc. But it is
        the WRONG anchor for a sibling-relative data-repo path like .aitriad.json's
        "../ai-triad-data": that assumes the anchor sits at the same filesystem depth as the
        actual main-repo root relative to ai-triad-data. That holds for a SIBLING worktree
        (../wt-x, same depth under repos/ as the main checkout) but not a NESTED one
        (.worktrees/x is one level too deep) -- confirmed empirically (t/3869): from a
        nested worktree, "../ai-triad-data" resolved to "<nested-worktree>/../ai-triad-data",
        which does not exist.

        `git rev-parse --git-common-dir` returns the MAIN checkout's .git directory
        regardless of which worktree (nested or sibling) you call it from -- its parent is
        the one true root every worktree should anchor sibling-relative paths against.
        Confirmed empirically from a nested worktree, a sibling worktree, and a plain
        (non-worktree) checkout.

        A single shared implementation rather than two independent reimplementations: this
        is the SAME logic Get-DataRoot/Get-SourcesDir use for the data-repo anchor, so other
        tooling with the identical "resolve the real repo root from inside any worktree"
        need can call the exact same code instead of reimplementing it -- eliminating drift
        risk rather than needing a parity test to catch it after the fact.

        Deliberately has ZERO module-scope dependencies (no $script:RepoRoot default, no
        New-ActionableError, no other module state) -- -Path is Mandatory, taken as an
        explicit argument, not read from module state. This lets the SAME FILE be loaded
        two ways: Export-ModuleMember'd as a Public cmdlet (this file, Public/), or dot-sourced
        standalone by a script that deliberately does not import the AITriad module (e.g.
        Verify-Config.ps1, which avoids the module-load taxonomy scan). Both call the
        identical implementation; there is only one copy to keep correct.
    .PARAMETER Path
        A directory inside the checkout to resolve from. Caller-supplied -- e.g. the
        AITriad module passes $script:RepoRoot; a standalone dot-sourcing caller passes its
        own already-resolved script/repo root.
    .OUTPUTS
        [string] absolute path to the main checkout's root, or $null when unresolvable
        (git unavailable, or -Path isn't a git checkout at all -- e.g. a PSGallery install).
        Returning $null rather than throwing lets callers fail over to their own existing
        anchor instead of breaking an install that never had git in the first place.
    .EXAMPLE
        Get-WorktreeMainRoot -Path $script:RepoRoot
        # From inside .worktrees/t3869-foo: C:\repos\ai-triad-research
    .EXAMPLE
        # Standalone, no module import (e.g. Verify-Config.ps1):
        . (Join-Path $PSScriptRoot 'AITriad\Public\Get-WorktreeMainRoot.ps1')
        Get-WorktreeMainRoot -Path $RepoRoot
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    Set-StrictMode -Version Latest

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $null }

    try {
        $CommonDir = & git -C $Path rev-parse --git-common-dir 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($CommonDir)) { return $null }
        $CommonDir = $CommonDir.Trim()
        if (-not [System.IO.Path]::IsPathRooted($CommonDir)) {
            $CommonDir = [System.IO.Path]::GetFullPath((Join-Path $Path $CommonDir))
        }
        return (Split-Path $CommonDir -Parent)
    } catch {
        return $null
    }
}
