# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepWindowsContainers {
    <#
    .SYNOPSIS
        Section 7a of Invoke-DependencyCheck (t/3910), Windows-only: the Containers optional
        feature + WSL. Extracted verbatim. The caller gates the Platform -eq 'Windows' check.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param([Parameter(Mandatory)][hashtable]$Ctx, [Parameter(Mandatory)][bool]$IsInstallMode, [Parameter(Mandatory)][bool]$Fix)

    Write-DepSection 'WINDOWS CONTAINERS & WSL (required for Docker)'

    # Containers feature
    $ContainersEnabled = $false
    try {
        $Feature = Get-WindowsOptionalFeature -Online -FeatureName Containers -ErrorAction SilentlyContinue
        if ($Feature -and $Feature.State -eq 'Enabled') { $ContainersEnabled = $true; Write-DepPass -Ctx $Ctx -Message 'Windows Containers feature enabled' }
    }
    catch { }
    if (-not $ContainersEnabled) {
        Write-DepFail -Ctx $Ctx -Message 'Windows Containers feature is not enabled'
        if ($IsInstallMode -and $Fix) {
            Write-DepFix 'Enabling Windows Containers feature...'
            try {
                Enable-WindowsOptionalFeature -Online -FeatureName Containers -All -NoRestart 2>&1 | Out-Null
                $Ctx.Fixed++; Write-DepPass -Ctx $Ctx -Message 'Containers feature enabled (restart may be required)'
            }
            catch { Write-DepFail -Ctx $Ctx -Message "Failed to enable Containers: $_ — try from an Admin terminal" }
        }
    }

    # WSL
    $WslReady = $false
    try {
        $WslOutput = wsl --status 2>&1
        if ($LASTEXITCODE -eq 0) { $WslReady = $true; Write-DepPass -Ctx $Ctx -Message 'WSL enabled' }
    }
    catch { }
    if (-not $WslReady) {
        Write-DepFail -Ctx $Ctx -Message 'WSL is not enabled'
        if ($IsInstallMode -and $Fix) {
            Write-DepFix 'Installing WSL...'
            try {
                wsl --install --no-distribution 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) { $Ctx.Fixed++; Write-DepPass -Ctx $Ctx -Message 'WSL installed (restart may be required)' }
                else { Write-DepFail -Ctx $Ctx -Message 'WSL install returned non-zero exit code — try "wsl --install" from an Admin terminal' }
            }
            catch { Write-DepFail -Ctx $Ctx -Message "WSL install failed: $_ — try 'wsl --install' from an Admin terminal" }
        }
    }
}
