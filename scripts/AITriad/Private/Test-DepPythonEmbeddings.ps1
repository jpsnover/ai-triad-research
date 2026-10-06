# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepPythonEmbeddings {
    <#
    .SYNOPSIS
        Section 6 of Invoke-DependencyCheck (t/3910): Python interpreter detection
        (Find-DepPythonCommand), package checks (Test-DepPythonPackages), and the
        embeddings.json check (Test-DepEmbeddingsFile). Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][bool]$SkipPython,
        [Parameter(Mandatory)][bool]$IsTestMode,
        [Parameter(Mandatory)][bool]$IsInstallMode,
        [Parameter(Mandatory)][bool]$Fix,
        [Parameter(Mandatory)][string]$Platform
    )

    if ($SkipPython) {
        Write-DepSection 'PYTHON & EMBEDDINGS (skipped)'
        Write-DepSkip -Message 'Skipped via -SkipPython'
        return
    }

    Write-DepSection 'PYTHON & EMBEDDINGS (optional)'

    $PythonCmd = Find-DepPythonCommand -Ctx $Ctx

    if (-not $PythonCmd) {
        Write-DepWarn -Ctx $Ctx -Message 'Python 3 not found — Update-TaxEmbeddings will not work'
        if ($IsInstallMode) {
            Install-DependencyPackage -Ctx $Ctx -Fix $Fix -Platform $Platform -Name 'python3' -PackageNames @{
                brew = 'python@3'; apt = 'python3'; dnf = 'python3'
                winget = 'Python.Python.3.12'; choco = 'python3'; scoop = 'python'
            }
        }
        return
    }

    Test-DepPythonPackages -Ctx $Ctx -RepoRoot $RepoRoot -PythonCmd $PythonCmd -IsTestMode $IsTestMode -IsInstallMode $IsInstallMode -Fix $Fix
    Test-DepEmbeddingsFile -Ctx $Ctx -IsTestMode $IsTestMode
}
