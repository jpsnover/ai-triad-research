# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Update-GitRepository {
    <#
    .SYNOPSIS
        Fast-forward a local git clone to its GitHub origin; never blocks the caller.
    .DESCRIPTION
        Launch-path repo sync used by Show-TaxonomyEditor (t/2478). Fetches origin
        and applies a fast-forward-only pull. Designed to degrade, not fail: a
        missing git, unreachable GitHub, or diverged local history produces a
        warning and $false — the caller launches with the local copy. Returns
        $true only when the repo is up to date or was fast-forwarded.
    .PARAMETER Path
        Root of the local clone (the directory containing .git).
    .PARAMETER Label
        Human-readable name used in status messages (e.g. 'data repository').
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [string]$Label = 'repository'
    )

    if (-not (Test-Path (Join-Path $Path '.git'))) {
        Write-Verbose "Update-GitRepository: $Path is not a git repository — skipping"
        return $false
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Warn "git is not available — using the local copy of the $Label as-is"
        return $false
    }

    Push-Location $Path
    try {
        $FetchOutput = git fetch origin 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Could not fetch the $Label from GitHub — continuing with the local copy"
            Write-Verbose ('git fetch: ' + (($FetchOutput | Out-String).Trim()))
            return $false
        }

        $PullOutput = git pull --ff-only 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "The $Label cannot be fast-forwarded (local changes or diverged history) — continuing with the local copy"
            Write-Info "Reconcile manually in ${Path}: commit or stash local work, then run 'git pull'"
            Write-Verbose ('git pull --ff-only: ' + (($PullOutput | Out-String).Trim()))
            return $false
        }

        if ((($PullOutput | Out-String)) -match 'Already up to date') {
            Write-OK "The $Label is up to date with GitHub"
        }
        else {
            Write-OK "The $Label was updated from GitHub"
        }
        return $true
    }
    finally {
        Pop-Location
    }
}
