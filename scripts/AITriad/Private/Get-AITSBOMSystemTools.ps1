# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMSystemTools {
    <#
    .SYNOPSIS
        SBOM entries for system-PATH tooling (git, node, npm, python, pip,
        pandoc, markitdown, gs), enriched with a winget install source where
        known. Extracted verbatim from Get-AITSBOM (t/3910) -- no behavior
        change.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param()

    Set-StrictMode -Version Latest
    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    $SystemTools = @(
        @{ Name = 'git';        Url = 'https://git-scm.com';                         VersionCmd = { (git --version) -replace 'git version\s*', '' } }
        @{ Name = 'node';       Url = 'https://nodejs.org';                           VersionCmd = { (node --version) -replace '^v', '' } }
        @{ Name = 'npm';        Url = 'https://www.npmjs.com';                        VersionCmd = { npm --version } }
        @{ Name = 'python';     Url = 'https://www.python.org';                       VersionCmd = { if (Get-Command python -EA SilentlyContinue) { $Cmd = 'python' } else { $Cmd = 'python3' }; (& $Cmd --version 2>&1) -replace 'Python\s*', '' } }
        @{ Name = 'pip';        Url = 'https://pip.pypa.io';                          VersionCmd = { if (Get-Command pip -EA SilentlyContinue) { $Cmd = 'pip' } else { $Cmd = 'pip3' }; (& $Cmd --version 2>&1) -replace 'pip\s+(\S+).*', '$1' } }
        @{ Name = 'pandoc';     Url = 'https://pandoc.org';                           VersionCmd = { pandoc --version | Select-Object -First 1 | ForEach-Object { $_ -replace 'pandoc\s*', '' } } }
        @{ Name = 'markitdown'; Url = 'https://github.com/microsoft/markitdown';      VersionCmd = { 'present' } }
        @{ Name = 'gs';         Url = 'https://www.ghostscript.com';                  VersionCmd = { (gs --version 2>&1) -replace '.*?(\d+\.\d+\S*)', '$1' | Select-Object -First 1 } }
    )

    $WingetInstalled = Get-AITSBOMWingetInstalled

    $WingetIdMap = @{
        'git'    = 'Git.Git'
        'node'   = 'OpenJS.NodeJS.LTS'
        'python' = 'Python.Python.3.12'
        'pandoc' = 'JohnMacFarlane.Pandoc'
    }

    foreach ($Tool in $SystemTools) {
        $ToolVer = 'not found'
        $Cmd = Get-Command $Tool.Name -ErrorAction SilentlyContinue
        if ($Cmd) {
            try { $ToolVer = & $Tool.VersionCmd }
            catch { $ToolVer = 'installed (version unknown)' }
        }

        $ToolInstaller = $null
        if ($WingetIdMap.ContainsKey($Tool.Name) -and $WingetInstalled.ContainsKey($WingetIdMap[$Tool.Name])) {
            $ToolInstaller = "winget ($($WingetIdMap[$Tool.Name]))"
        }
        elseif ($Tool.Name -in @('npm'))       { $ToolInstaller = 'bundled (node)' }
        elseif ($Tool.Name -in @('pip'))       { $ToolInstaller = 'bundled (python)' }
        elseif ($Tool.Name -in @('markitdown')) { $ToolInstaller = 'pip' }

        $Entries.Add([PSCustomObject]@{
            Name          = $Tool.Name
            Version       = $ToolVer
            LatestVersion = $null
            Status        = $null
            Type          = 'system'
            Scope         = 'required'
            Source        = 'system PATH'
            SourceUrl     = $Tool.Url
            License       = $null
            Supplier      = $null
            Description   = $null
            Hash          = $null
            InstalledVia  = $ToolInstaller
        })
    }

    # Comma-wrap: see Get-AITSBOMAIModels.ps1 for why -- without it, the List[PSObject]
    # flattens to a plain array at the return boundary, losing .AddRange() in the caller.
    return ,$Entries
}
