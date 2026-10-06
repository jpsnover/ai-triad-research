# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepGit {
    <#
    .SYNOPSIS
        Section 2 of Invoke-DependencyCheck (t/3910): git presence + repo smoke test.
        Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][bool]$IsInstallMode,
        [Parameter(Mandatory)][bool]$Fix,
        [Parameter(Mandatory)][string]$Platform
    )

    Write-DepSection 'GIT (required)'

    if (Get-Command git -ErrorAction SilentlyContinue) {
        try {
            $GitVer = (git --version 2>&1) -replace 'git version ', ''
            $GitRoot = git -C $RepoRoot rev-parse --show-toplevel 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-DepPass -Ctx $Ctx -Message "git $GitVer"
            }
            else {
                Write-DepWarn -Ctx $Ctx -Message "git $GitVer installed but repo check failed"
            }
        }
        catch { Write-DepWarn -Ctx $Ctx -Message "git found but smoke test failed: $_" }
    }
    else {
        Write-DepFail -Ctx $Ctx -Message 'git not found'
        if ($IsInstallMode) {
            Install-DependencyPackage -Ctx $Ctx -Fix $Fix -Platform $Platform -Name 'git' -PackageNames @{
                brew = 'git'; apt = 'git'; dnf = 'git'; winget = 'Git.Git'; choco = 'git'
            }
        }
    }
}
