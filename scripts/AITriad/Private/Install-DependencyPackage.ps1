# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Install-DependencyPackage {
    <#
    .SYNOPSIS
        Attempts to install a missing dependency via the detected OS package manager
        (t/3910). Extracted verbatim (was the closure Install-Pkg).
    .PARAMETER Ctx
        The shared counters/results hashtable.
    .PARAMETER Fix
        Whether -Fix was passed to Invoke-DependencyCheck; a no-op (returns $false) if not.
    .PARAMETER Platform
        'macOS', 'Linux', or 'Windows'.
    .PARAMETER Name
        Human-readable dependency name, used in messages.
    .PARAMETER PackageNames
        Hashtable keyed by package-manager name ('brew','apt','dnf','yum','winget','choco','scoop')
        to that manager's package name for this dependency.
    .OUTPUTS
        [bool] whether the install succeeded.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][bool]$Fix,
        [Parameter(Mandatory)][string]$Platform,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][hashtable]$PackageNames
    )

    if (-not $Fix) { return $false }
    $PM = Get-DependencyPackageManager -Platform $Platform
    if (-not $PM) { Write-DepFail -Ctx $Ctx -Message "Cannot auto-install '$Name' — no package manager found"; return $false }
    $PkgName = $PackageNames[$PM]
    if (-not $PkgName) { Write-DepFail -Ctx $Ctx -Message "No package mapping for '$Name' on $PM"; return $false }
    Write-DepFix "Installing $Name via $PM ($PkgName)..."
    try {
        switch ($PM) {
            'brew'   { & brew install $PkgName 2>&1 | Out-Null }
            'apt'    { & sudo apt-get install -y $PkgName 2>&1 | Out-Null }
            'dnf'    { & sudo dnf install -y $PkgName 2>&1 | Out-Null }
            'yum'    { & sudo yum install -y $PkgName 2>&1 | Out-Null }
            'winget' { & winget install --id $PkgName --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null }
            'choco'  { & choco install $PkgName -y 2>&1 | Out-Null }
            'scoop'  { & scoop install $PkgName 2>&1 | Out-Null }
        }
        if ($LASTEXITCODE -eq 0) { $Ctx.Fixed++; Write-DepPass -Ctx $Ctx -Message "$Name installed"; return $true }
        else { Write-DepFail -Ctx $Ctx -Message "$Name installation failed (exit code $LASTEXITCODE)"; return $false }
    }
    catch { Write-DepFail -Ctx $Ctx -Message "$Name installation failed: $_"; return $false }
}
