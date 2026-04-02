# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOM {
    <#
    .SYNOPSIS
        Generates a Software Bill of Materials (SBOM) for the AI Triad project.
    .DESCRIPTION
        Enumerates all project dependencies across PowerShell modules, Node.js
        packages, Python packages, system tools, AI models, and schemas.

        With -CheckUpdates, queries package registries for latest versions.
        With -Update, upgrades outdated packages (prompts unless -Force).
    .PARAMETER CheckUpdates
        Query registries for latest available versions.
    .PARAMETER Update
        Update outdated packages. Prompts for confirmation unless -Force.
    .PARAMETER Force
        Skip confirmation prompts when updating.
    .PARAMETER Format
        Output format: Table (default), Json, Csv, CycloneDX, SPDX.
    .PARAMETER RepoRoot
        Repository root path. Defaults to module-resolved root.
    .EXAMPLE
        Get-AITSBOM
    .EXAMPLE
        Get-AITSBOM -CheckUpdates
    .EXAMPLE
        Get-AITSBOM -Update -Force
    .EXAMPLE
        Get-AITSBOM -Format CycloneDX | Set-Content sbom.cdx.json
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [switch]$CheckUpdates,

        [switch]$Update,

        [switch]$Force,

        [ValidateSet('Table', 'Json', 'Csv', 'CycloneDX', 'SPDX')]
        [string]$Format = 'Table',

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if ($Update) { $CheckUpdates = $true }

    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    # ── 1. PowerShell modules ─────────────────────────────────────────────────
    Write-Verbose 'Scanning PowerShell modules...'

    # From AITriad.psd1 RequiredModules
    $ManifestPath = Join-Path $script:ModuleRoot 'AITriad.psd1'
    if (Test-Path $ManifestPath) {
        try {
            $Manifest = Import-PowerShellDataFile -Path $ManifestPath
            if ($Manifest.ContainsKey('RequiredModules') -and $Manifest.RequiredModules) {
                foreach ($Req in $Manifest.RequiredModules) {
                    $ModName = if ($Req -is [string]) { $Req } else { $Req.ModuleName }
                    $ModVer  = if ($Req -is [hashtable] -and $Req.ModuleVersion) { $Req.ModuleVersion } else { $null }
                    if (-not $ModVer) {
                        $Installed = Get-Module -ListAvailable -Name $ModName -ErrorAction SilentlyContinue | Select-Object -First 1
                        $ModVer = if ($Installed) { $Installed.Version.ToString() } else { 'not installed' }
                    }
                    $Entries.Add([PSCustomObject]@{
                        Name          = $ModName
                        Version       = $ModVer
                        LatestVersion = $null
                        Status        = $null
                        Type          = 'ps-module'
                        Source        = 'AITriad.psd1 RequiredModules'
                        License       = $null
                    })
                }
            }
        }
        catch {
            Write-Warning "Failed to read AITriad.psd1: $($_.Exception.Message)"
        }
    }

    # Companion modules
    foreach ($Companion in @('AIEnrich', 'DocConverters', 'PdfOptimizer')) {
        $CompPath = Join-Path $script:ModuleRoot '..' "$Companion.psm1"
        $CompVer = 'present'
        if (Test-Path $CompPath) {
            $PsdPath = $CompPath -replace '\.psm1$', '.psd1'
            if (Test-Path $PsdPath) {
                try {
                    $CompManifest = Import-PowerShellDataFile -Path $PsdPath
                    $CompVer = $CompManifest.ModuleVersion
                }
                catch { }
            }
        }
        else {
            $CompVer = 'not found'
        }

        $Entries.Add([PSCustomObject]@{
            Name          = $Companion
            Version       = $CompVer
            LatestVersion = $null
            Status        = $null
            Type          = 'ps-module'
            Source        = "scripts/$Companion.psm1"
            License       = 'MIT'
        })
    }

    # ── 2. Node.js packages ───────────────────────────────────────────────────
    Write-Verbose 'Scanning Node.js packages...'

    $AppDirs = @('taxonomy-editor', 'poviewer', 'summary-viewer')
    # Root package.json (shared lib)
    $RootPkg = Join-Path $RepoRoot 'package.json'
    if (Test-Path $RootPkg) { $AppDirs = @('') + $AppDirs }

    foreach ($AppDir in $AppDirs) {
        $PkgPath = if ($AppDir) { Join-Path $RepoRoot $AppDir 'package.json' } else { $RootPkg }
        if (-not (Test-Path $PkgPath)) { continue }

        $SourceLabel = if ($AppDir) { "$AppDir/package.json" } else { 'package.json' }
        try {
            $Pkg = Get-Content -Raw -Path $PkgPath | ConvertFrom-Json -Depth 10

            foreach ($DepType in @('dependencies', 'devDependencies')) {
                if (-not $Pkg.PSObject.Properties[$DepType]) { continue }
                foreach ($Prop in $Pkg.$DepType.PSObject.Properties) {
                    $CleanVer = $Prop.Value -replace '[\^~>=<]', ''
                    $PkgType  = if ($DepType -eq 'devDependencies') { 'npm-dev' } else { 'npm' }
                    $Entries.Add([PSCustomObject]@{
                        Name          = $Prop.Name
                        Version       = $CleanVer
                        LatestVersion = $null
                        Status        = $null
                        Type          = $PkgType
                        Source        = $SourceLabel
                        License       = $null
                    })
                }
            }
        }
        catch {
            Write-Warning "Failed to parse $SourceLabel`: $($_.Exception.Message)"
        }
    }

    # ── 3. Python packages ────────────────────────────────────────────────────
    Write-Verbose 'Scanning Python packages...'

    $ReqPath = Join-Path $RepoRoot 'scripts' 'requirements.txt'
    if (Test-Path $ReqPath) {
        $Lines = Get-Content -Path $ReqPath
        foreach ($Line in $Lines) {
            $Line = $Line.Trim()
            if (-not $Line -or $Line.StartsWith('#')) { continue }
            # Parse: package>=version or package[extras]>=version
            if ($Line -match '^([a-zA-Z0-9_.\-]+(?:\[[^\]]+\])?)(?:[><=!~]+(.+))?$') {
                $PkgName = $Matches[1]
                $PkgVer  = if ($Matches[2]) { $Matches[2] } else { 'any' }
                $Entries.Add([PSCustomObject]@{
                    Name          = $PkgName
                    Version       = $PkgVer
                    LatestVersion = $null
                    Status        = $null
                    Type          = 'python'
                    Source        = 'scripts/requirements.txt'
                    License       = $null
                })
            }
        }
    }

    # ── 4. System tools ───────────────────────────────────────────────────────
    Write-Verbose 'Scanning system tools...'

    $SystemTools = @(
        @{ Name = 'git';       VersionCmd = { (git --version) -replace 'git version\s*', '' } }
        @{ Name = 'node';      VersionCmd = { (node --version) -replace '^v', '' } }
        @{ Name = 'npm';       VersionCmd = { npm --version } }
        @{ Name = 'python';    VersionCmd = { $Cmd = if (Get-Command python -EA SilentlyContinue) { 'python' } else { 'python3' }; (& $Cmd --version 2>&1) -replace 'Python\s*', '' } }
        @{ Name = 'pip';       VersionCmd = { $Cmd = if (Get-Command pip -EA SilentlyContinue) { 'pip' } else { 'pip3' }; (& $Cmd --version 2>&1) -replace 'pip\s+(\S+).*', '$1' } }
        @{ Name = 'pandoc';    VersionCmd = { pandoc --version | Select-Object -First 1 | ForEach-Object { $_ -replace 'pandoc\s*', '' } } }
        @{ Name = 'markitdown'; VersionCmd = { 'present' } }
    )

    foreach ($Tool in $SystemTools) {
        $ToolVer = 'not found'
        $Cmd = Get-Command $Tool.Name -ErrorAction SilentlyContinue
        if ($Cmd) {
            try { $ToolVer = & $Tool.VersionCmd }
            catch { $ToolVer = 'installed (version unknown)' }
        }

        $Entries.Add([PSCustomObject]@{
            Name          = $Tool.Name
            Version       = $ToolVer
            LatestVersion = $null
            Status        = $null
            Type          = 'system'
            Source        = 'system PATH'
            License       = $null
        })
    }

    # ── 5. AI models ──────────────────────────────────────────────────────────
    Write-Verbose 'Scanning AI models...'

    $ModelsPath = Join-Path $RepoRoot 'ai-models.json'
    if (Test-Path $ModelsPath) {
        try {
            $ModelConfig = Get-Content -Raw -Path $ModelsPath | ConvertFrom-Json -Depth 10
            foreach ($Model in $ModelConfig.models) {
                $Entries.Add([PSCustomObject]@{
                    Name          = $Model.id
                    Version       = if ($Model.PSObject.Properties['version']) { $Model.version } else { 'latest' }
                    LatestVersion = $null
                    Status        = $null
                    Type          = 'ai-model'
                    Source        = 'ai-models.json'
                    License       = if ($Model.PSObject.Properties['license']) { $Model.license } else { $null }
                })
            }
        }
        catch {
            Write-Warning "Failed to parse ai-models.json: $($_.Exception.Message)"
        }
    }

    # ── 6. Schemas ────────────────────────────────────────────────────────────
    Write-Verbose 'Scanning schemas...'

    $SchemaDir = Join-Path $RepoRoot 'taxonomy' 'schemas'
    if (Test-Path $SchemaDir) {
        foreach ($SchemaFile in Get-ChildItem -Path $SchemaDir -Filter '*.schema.json' -File) {
            $SchemaVer = 'unknown'
            try {
                $Schema = Get-Content -Raw -Path $SchemaFile.FullName | ConvertFrom-Json -Depth 5
                if ($Schema.PSObject.Properties['version']) { $SchemaVer = $Schema.version }
                elseif ($Schema.PSObject.Properties['$schema']) { $SchemaVer = 'json-schema' }
            }
            catch { }

            $Entries.Add([PSCustomObject]@{
                Name          = $SchemaFile.BaseName
                Version       = $SchemaVer
                LatestVersion = $null
                Status        = $null
                Type          = 'schema'
                Source        = "taxonomy/schemas/$($SchemaFile.Name)"
                License       = $null
            })
        }
    }

    # ── CheckUpdates ──────────────────────────────────────────────────────────
    if ($CheckUpdates) {
        Write-Verbose 'Checking for updates...'

        foreach ($Entry in $Entries) {
            switch ($Entry.Type) {
                'npm' {
                    try {
                        $Latest = Invoke-WithRecovery -Goal "check npm registry for $($Entry.Name)" `
                            -Location 'Get-AITSBOM' -MaxRetries 1 -RetryDelaySeconds 2 `
                            -Action {
                                $Result = npm view $Entry.Name version 2>$null
                                if ($LASTEXITCODE -ne 0) { throw "npm view failed" }
                                $Result.Trim()
                            } `
                            -NextSteps @('Check network connectivity', 'Verify npm is installed')
                        $Entry.LatestVersion = $Latest
                        $Entry.Status = if ($Entry.Version -eq $Latest) { 'up-to-date' } else { 'outdated' }
                    }
                    catch { $Entry.Status = 'unknown' }
                }
                'npm-dev' {
                    try {
                        $Latest = (npm view $Entry.Name version 2>$null)
                        if ($Latest) {
                            $Entry.LatestVersion = $Latest.Trim()
                            $Entry.Status = if ($Entry.Version -eq $Entry.LatestVersion) { 'up-to-date' } else { 'outdated' }
                        }
                        else { $Entry.Status = 'unknown' }
                    }
                    catch { $Entry.Status = 'unknown' }
                }
                'python' {
                    try {
                        $PkgName = $Entry.Name -replace '\[.*\]', ''  # Strip extras
                        $PyCmd = if (Get-Command pip -EA SilentlyContinue) { 'pip' } else { 'pip3' }
                        $Info = & $PyCmd index versions $PkgName 2>$null
                        if ($Info -match 'Available versions:\s*(.+)') {
                            $Latest = ($Matches[1] -split ',\s*')[0].Trim()
                            $Entry.LatestVersion = $Latest
                            $Entry.Status = if ($Entry.Version -ge $Latest) { 'up-to-date' } else { 'outdated' }
                        }
                        else { $Entry.Status = 'unknown' }
                    }
                    catch { $Entry.Status = 'unknown' }
                }
                'ps-module' {
                    try {
                        $Found = Find-Module -Name $Entry.Name -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($Found) {
                            $Entry.LatestVersion = $Found.Version.ToString()
                            $Entry.Status = if ($Entry.Version -eq $Entry.LatestVersion) { 'up-to-date' } else { 'outdated' }
                        }
                        else { $Entry.Status = 'unknown' }
                    }
                    catch { $Entry.Status = 'unknown' }
                }
                default {
                    $Entry.Status = 'n/a'
                }
            }
        }
    }

    # ── Update ────────────────────────────────────────────────────────────────
    if ($Update) {
        $Outdated = @($Entries | Where-Object { $_.Status -eq 'outdated' })
        if ($Outdated.Count -eq 0) {
            Write-Host '  All packages are up to date.' -ForegroundColor Green
        }
        else {
            Write-Host "  $($Outdated.Count) outdated package(s) found:" -ForegroundColor Yellow
            foreach ($Pkg in $Outdated) {
                Write-Host "    $($Pkg.Name): $($Pkg.Version) → $($Pkg.LatestVersion) ($($Pkg.Type))" -ForegroundColor Yellow
            }

            if (-not $Force) {
                $Confirm = Read-Host "`n  Update all? (y/N)"
                if ($Confirm -notin @('y', 'Y', 'yes')) {
                    Write-Host '  Update cancelled.' -ForegroundColor Gray
                    $Update = $false
                }
            }

            if ($Update) {
                foreach ($Pkg in $Outdated) {
                    try {
                        switch ($Pkg.Type) {
                            { $_ -in @('npm', 'npm-dev') } {
                                # Determine which app dir
                                $AppDir = ($Pkg.Source -split '/')[0]
                                $WorkDir = if ($AppDir -eq 'package.json') { $RepoRoot } else { Join-Path $RepoRoot $AppDir }
                                if ($PSCmdlet.ShouldProcess($Pkg.Name, "npm update in $AppDir")) {
                                    Push-Location $WorkDir
                                    npm update $Pkg.Name 2>&1 | Out-Null
                                    Pop-Location
                                    Write-Host "    Updated $($Pkg.Name)" -ForegroundColor Green
                                }
                            }
                            'python' {
                                $PkgName = $Pkg.Name -replace '\[.*\]', ''
                                $PyCmd = if (Get-Command pip -EA SilentlyContinue) { 'pip' } else { 'pip3' }
                                if ($PSCmdlet.ShouldProcess($PkgName, 'pip install --upgrade')) {
                                    & $PyCmd install --upgrade $PkgName 2>&1 | Out-Null
                                    Write-Host "    Updated $PkgName" -ForegroundColor Green
                                }
                            }
                            'ps-module' {
                                if ($PSCmdlet.ShouldProcess($Pkg.Name, 'Update-Module')) {
                                    Update-Module -Name $Pkg.Name -Force
                                    Write-Host "    Updated $($Pkg.Name)" -ForegroundColor Green
                                }
                            }
                            default {
                                Write-Verbose "  Skipping $($Pkg.Name) ($($Pkg.Type)) — manual update required"
                            }
                        }
                    }
                    catch {
                        New-ActionableError -Goal "update $($Pkg.Name)" `
                            -Problem $_.Exception.Message `
                            -Location 'Get-AITSBOM -Update' `
                            -NextSteps @(
                                "Try manually: update $($Pkg.Name) via $($Pkg.Type) package manager",
                                'Check network connectivity'
                            )
                    }
                }
            }
        }
    }

    # ── Output formatting ─────────────────────────────────────────────────────
    $OutputEntries = if ($CheckUpdates) {
        $Entries | Select-Object Name, Version, LatestVersion, Status, Type, Source, License
    }
    else {
        $Entries | Select-Object Name, Version, Type, Source, License
    }

    switch ($Format) {
        'Table' {
            $OutputEntries | Format-Table -AutoSize | Out-Host
            return $Entries
        }
        'Json' {
            return ($OutputEntries | ConvertTo-Json -Depth 5)
        }
        'Csv' {
            return ($OutputEntries | ConvertTo-Csv -NoTypeInformation)
        }
        'CycloneDX' {
            # CycloneDX 1.5 JSON format
            $Components = @($Entries | ForEach-Object {
                $PurlType = switch ($_.Type) {
                    'npm'       { 'npm' }
                    'npm-dev'   { 'npm' }
                    'python'    { 'pypi' }
                    'ps-module' { 'nuget' }
                    default     { 'generic' }
                }
                [ordered]@{
                    type    = 'library'
                    name    = $_.Name
                    version = $_.Version
                    purl    = "pkg:$PurlType/$($_.Name)@$($_.Version)"
                    properties = @(
                        [ordered]@{ name = 'source'; value = $_.Source }
                        [ordered]@{ name = 'component-type'; value = $_.Type }
                    )
                }
                if ($_.License) {
                    # Add license to last component
                }
            })

            $CycloneDX = [ordered]@{
                bomFormat   = 'CycloneDX'
                specVersion = '1.5'
                version     = 1
                metadata    = [ordered]@{
                    timestamp = (Get-Date).ToString('o')
                    component = [ordered]@{
                        type    = 'application'
                        name    = 'ai-triad-research'
                        version = (Import-PowerShellDataFile -Path $ManifestPath).ModuleVersion
                    }
                }
                components  = $Components
            }

            return ($CycloneDX | ConvertTo-Json -Depth 10)
        }
        'SPDX' {
            # SPDX 2.3 JSON format
            $Packages = @($Entries | ForEach-Object {
                [ordered]@{
                    SPDXID               = "SPDXRef-$($_.Name -replace '[^a-zA-Z0-9._-]', '-')"
                    name                 = $_.Name
                    versionInfo          = $_.Version
                    downloadLocation     = 'NOASSERTION'
                    filesAnalyzed        = $false
                    supplier             = 'NOASSERTION'
                    externalRefs         = @(
                        [ordered]@{
                            referenceCategory = 'PACKAGE-MANAGER'
                            referenceType     = 'purl'
                            referenceLocator  = "pkg:generic/$($_.Name)@$($_.Version)"
                        }
                    )
                }
            })

            $SPDX = [ordered]@{
                spdxVersion       = 'SPDX-2.3'
                dataLicense       = 'CC0-1.0'
                SPDXID            = 'SPDXRef-DOCUMENT'
                name              = 'ai-triad-research-sbom'
                documentNamespace = "https://spdx.org/spdxdocs/ai-triad-research-$(New-Guid)"
                creationInfo      = [ordered]@{
                    created  = (Get-Date).ToString('o')
                    creators = @('Tool: Get-AITSBOM')
                }
                packages          = $Packages
            }

            return ($SPDX | ConvertTo-Json -Depth 10)
        }
    }
}
