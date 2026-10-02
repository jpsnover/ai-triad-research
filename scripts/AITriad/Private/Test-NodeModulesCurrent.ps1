# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-NodeModulesCurrent {
    <#
    .SYNOPSIS
        Report whether the workspace node_modules matches the committed pnpm lockfile.
    .DESCRIPTION
        pnpm records the lockfile it last installed from at node_modules/.pnpm/lock.yaml.
        Comparing that copy against <RepoRoot>/pnpm-lock.yaml tells Show-TaxonomyEditor
        when a pull brought in dependency changes that `npm run dev` would otherwise run
        against stale packages (2026-10-02: a dependency-override bump landed on main but
        the launch kept the old install). Line endings are normalized so a CRLF checkout
        of the lockfile does not read as a change.
    .PARAMETER RepoRoot
        Root of the pnpm workspace (the directory containing pnpm-lock.yaml).
    .OUTPUTS
        [pscustomobject] with Current ([bool]) and Reason, one of:
          'current'           — installed lockfile matches the committed one
          'not-installed'     — no node_modules/.pnpm/lock.yaml (never installed)
          'lockfile-changed'  — committed lockfile differs from the installed one
          'no-lockfile'       — no pnpm-lock.yaml at RepoRoot; cannot judge, reported current
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    $Committed = Join-Path $RepoRoot 'pnpm-lock.yaml'
    $Installed = Join-Path $RepoRoot (Join-Path 'node_modules' (Join-Path '.pnpm' 'lock.yaml'))

    if (-not (Test-Path -LiteralPath $Committed)) {
        Write-Warn "No pnpm-lock.yaml at $RepoRoot — cannot check whether Node modules are current; skipping the dependency refresh"
        return [pscustomobject]@{ Current = $true; Reason = 'no-lockfile' }
    }
    if (-not (Test-Path -LiteralPath $Installed)) {
        return [pscustomobject]@{ Current = $false; Reason = 'not-installed' }
    }

    $CommittedText = [System.IO.File]::ReadAllText($Committed).Replace("`r`n", "`n")
    $InstalledText = [System.IO.File]::ReadAllText($Installed).Replace("`r`n", "`n")
    if ($CommittedText -ceq $InstalledText) {
        return [pscustomobject]@{ Current = $true; Reason = 'current' }
    }
    return [pscustomobject]@{ Current = $false; Reason = 'lockfile-changed' }
}
