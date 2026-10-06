# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-DependencyPackageManager {
    <#
    .SYNOPSIS
        Detects the available OS package manager for Invoke-DependencyCheck (t/3910).
        Extracted verbatim (was the closure Get-PkgMgr).
    .PARAMETER Platform
        'macOS', 'Linux', or 'Windows' (from Resolve-DependencyPlatform).
    .OUTPUTS
        [string] one of 'brew','apt','dnf','yum','winget','choco','scoop', or $null.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][string]$Platform)

    if ($Platform -eq 'macOS') {
        if (Get-Command brew -ErrorAction SilentlyContinue) { return 'brew' }
    }
    if ($Platform -eq 'Linux') {
        if (Get-Command apt-get -ErrorAction SilentlyContinue) { return 'apt' }
        if (Get-Command dnf -ErrorAction SilentlyContinue) { return 'dnf' }
        if (Get-Command yum -ErrorAction SilentlyContinue) { return 'yum' }
    }
    if ($Platform -eq 'Windows') {
        if (Get-Command winget -ErrorAction SilentlyContinue) { return 'winget' }
        if (Get-Command choco -ErrorAction SilentlyContinue) { return 'choco' }
        if (Get-Command scoop -ErrorAction SilentlyContinue) { return 'scoop' }
    }
    return $null
}
