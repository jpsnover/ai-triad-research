# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOM {
    <#
    .SYNOPSIS
        Generates a Software Bill of Materials (SBOM) for the AI Triad project.
    .DESCRIPTION
        Enumerates all project dependencies across PowerShell modules, Node.js
        packages, Python packages, system tools, AI models, and schemas.

        Enriches entries with license, supplier, description, and integrity hash
        from local lock files and package metadata (no network calls).

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
        Get-AITSBOM -Format Json | Set-Content sbom.json
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

    $ManifestPath = Join-Path $script:ModuleRoot 'AITriad.psd1'
    if (Test-Path $ManifestPath) {
        try {
            $Manifest = Import-PowerShellDataFile -Path $ManifestPath
            if ($Manifest.ContainsKey('RequiredModules') -and $Manifest.RequiredModules) {
                foreach ($Req in $Manifest.RequiredModules) {
                    if ($Req -is [string]) { $ModName = $Req } else { $ModName = $Req.ModuleName }
                    if ($Req -is [hashtable] -and $Req.ModuleVersion) { $ModVer = $Req.ModuleVersion } else { $ModVer = $null }
                    if (-not $ModVer) {
                        $Installed = Get-Module -ListAvailable -Name $ModName -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($Installed) { $ModVer = $Installed.Version.ToString() } else { $ModVer = 'not installed' }
                    }
                    $Entries.Add([PSCustomObject]@{
                        Name          = $ModName
                        Version       = $ModVer
                        LatestVersion = $null
                        Status        = $null
                        Type          = 'ps-module'
                        Scope         = 'required'
                        Source        = 'AITriad.psd1 RequiredModules'
                        SourceUrl     = "https://www.powershellgallery.com/packages/$ModName/"
                        License       = $null
                        Supplier      = $null
                        Description   = $null
                        Hash          = $null
                        InstalledVia  = 'PSGallery'
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
        $CompPath = Join-Path (Join-Path $script:ModuleRoot '..') "$Companion.psm1"
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
            Scope         = 'required'
            Source        = "scripts/$Companion.psm1"
            SourceUrl     = $null
            License       = 'MIT'
            Supplier      = 'AI Triad Research'
            Description   = $null
            Hash          = $null
            InstalledVia  = 'project'
        })
    }

    # ── 2. Node.js packages ───────────────────────────────────────────────────
    Write-Verbose 'Scanning Node.js packages...'

    $AppDirs = @('taxonomy-editor', 'poviewer', 'summary-viewer', 'workflow-app', 'lib')
    $RootPkg = Join-Path $RepoRoot 'package.json'
    if (Test-Path $RootPkg) { $AppDirs = @('') + $AppDirs }

    foreach ($AppDir in $AppDirs) {
        if ($AppDir) { $PkgPath = Join-Path (Join-Path $RepoRoot $AppDir) 'package.json' } else { $PkgPath = $RootPkg }
        if (-not (Test-Path $PkgPath)) { continue }

        if ($AppDir) { $SourceLabel = "$AppDir/package.json" } else { $SourceLabel = 'package.json' }
        try {
            $Pkg = Get-Content -Raw -Path $PkgPath | ConvertFrom-Json

            foreach ($DepType in @('dependencies', 'devDependencies')) {
                if (-not $Pkg.PSObject.Properties[$DepType]) { continue }
                $DepScope = if ($DepType -eq 'devDependencies') { 'development' } else { 'required' }
                $PkgType  = if ($DepType -eq 'devDependencies') { 'npm-dev' } else { 'npm' }
                foreach ($Prop in $Pkg.$DepType.PSObject.Properties) {
                    $CleanVer = $Prop.Value -replace '[\^~>=<]', ''
                    $Entries.Add([PSCustomObject]@{
                        Name          = $Prop.Name
                        Version       = $CleanVer
                        LatestVersion = $null
                        Status        = $null
                        Type          = $PkgType
                        Scope         = $DepScope
                        Source        = $SourceLabel
                        SourceUrl     = "https://www.npmjs.com/package/$($Prop.Name)"
                        License       = $null
                        Supplier      = $null
                        Description   = $null
                        Hash          = $null
                        InstalledVia  = 'npm'
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

    $ReqPath = Join-Path (Join-Path $RepoRoot 'scripts') 'requirements.txt'
    if (Test-Path $ReqPath) {
        $Lines = Get-Content -Path $ReqPath
        foreach ($Line in $Lines) {
            $Line = $Line.Trim()
            if (-not $Line -or $Line.StartsWith('#')) { continue }
            if ($Line -match '^([a-zA-Z0-9_.\-]+(?:\[[^\]]+\])?)(?:[><=!~]+(.+))?$') {
                $PkgName = $Matches[1]
                if ($Matches[2]) { $PkgVer = $Matches[2] } else { $PkgVer = 'any' }
                $PyUrlName = $PkgName -replace '\[.*\]', ''
                $Entries.Add([PSCustomObject]@{
                    Name          = $PkgName
                    Version       = $PkgVer
                    LatestVersion = $null
                    Status        = $null
                    Type          = 'python'
                    Scope         = 'required'
                    Source        = 'scripts/requirements.txt'
                    SourceUrl     = "https://pypi.org/project/$PyUrlName/"
                    License       = $null
                    Supplier      = $null
                    Description   = $null
                    Hash          = $null
                    InstalledVia  = 'pip'
                })
            }
        }
    }

    # ── 4. System tools ───────────────────────────────────────────────────────
    Write-Verbose 'Scanning system tools...'

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

    # Pre-build winget lookup for system tools
    $WingetInstalled = @{}
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            $WingetRaw = winget list 2>$null
            if ($WingetRaw) {
                foreach ($WLine in $WingetRaw) {
                    if ($WLine -match '^\s*(\S.+?)\s{2,}(\S+\.\S+)\s{2,}(\S+)') {
                        $WingetInstalled[$Matches[2]] = $Matches[3]
                    }
                }
            }
        }
        catch { }
    }

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

    # ── 5. AI models ──────────────────────────────────────────────────────────
    Write-Verbose 'Scanning AI models...'

    $ModelsPath = Join-Path $RepoRoot 'ai-models.json'
    if (Test-Path $ModelsPath) {
        try {
            $ModelConfig = Get-Content -Raw -Path $ModelsPath | ConvertFrom-Json
            foreach ($Model in $ModelConfig.models) {
                $ModelUrl = $null
                if ($Model.PSObject.Properties['backend']) {
                    $ModelUrl = switch ($Model.backend) {
                        'gemini'    { "https://ai.google.dev/models/$($Model.id)" }
                        'anthropic' { "https://docs.anthropic.com/en/docs/about-claude/models" }
                        'groq'      { "https://console.groq.com/docs/models" }
                        'openai'    { "https://platform.openai.com/docs/models/$($Model.id)" }
                        default     { $null }
                    }
                }
                $ModelSupplier = if ($Model.PSObject.Properties['backend']) { $Model.backend } else { $null }
                $Entries.Add([PSCustomObject]@{
                    Name          = $Model.id
                    Version       = if ($Model.PSObject.Properties['version']) { $Model.version } else { 'latest' }
                    LatestVersion = $null
                    Status        = $null
                    Type          = 'ai-model'
                    Scope         = 'required'
                    Source        = 'ai-models.json'
                    SourceUrl     = $ModelUrl
                    License       = if ($Model.PSObject.Properties['license']) { $Model.license } else { $null }
                    Supplier      = $ModelSupplier
                    Description   = if ($Model.PSObject.Properties['display_name']) { $Model.display_name } else { $null }
                    Hash          = $null
                    InstalledVia  = 'API'
                })
            }
        }
        catch {
            Write-Warning "Failed to parse ai-models.json: $($_.Exception.Message)"
        }
    }

    # ── 6. Schemas ────────────────────────────────────────────────────────────
    Write-Verbose 'Scanning schemas...'

    $SchemaDir = Join-Path (Join-Path $RepoRoot 'taxonomy') 'schemas'
    if (Test-Path $SchemaDir) {
        foreach ($SchemaFile in Get-ChildItem -Path $SchemaDir -Filter '*.schema.json' -File) {
            $SchemaVer = 'unknown'
            try {
                $Schema = Get-Content -Raw -Path $SchemaFile.FullName | ConvertFrom-Json
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
                Scope         = 'required'
                Source        = "taxonomy/schemas/$($SchemaFile.Name)"
                SourceUrl     = $null
                License       = 'MIT'
                Supplier      = 'AI Triad Research'
                Description   = $null
                Hash          = $null
                InstalledVia  = 'project'
            })
        }
    }

    # ── 7. Local metadata enrichment (no network) ─────────────────────────────
    Write-Verbose 'Enriching from local metadata...'

    # 7a. npm: parse lock files for license, integrity hash, download URL
    $NpmEntries = @($Entries | Where-Object { $_.Type -in @('npm', 'npm-dev') })
    if ($NpmEntries.Count -gt 0) {
        $LockCache = @{}
        $ProcessedSources = [System.Collections.Generic.HashSet[string]]::new()

        foreach ($NpmEntry in $NpmEntries) {
            $SourceKey = $NpmEntry.Source -replace '/package\.json$', ''
            if (-not $ProcessedSources.Add($SourceKey)) { continue }

            if ($SourceKey -eq 'package.json') { $LockPath = Join-Path $RepoRoot 'package-lock.json' }
            else { $LockPath = Join-Path (Join-Path $RepoRoot $SourceKey) 'package-lock.json' }

            if (-not (Test-Path $LockPath)) { continue }

            try {
                $Lock = Get-Content -Raw -Path $LockPath | ConvertFrom-Json -AsHashtable
                if ($Lock.ContainsKey('packages')) {
                    foreach ($Key in $Lock.packages.Keys) {
                        if (-not $Key.StartsWith('node_modules/')) { continue }
                        $PkgNameFromLock = $Key.Substring('node_modules/'.Length)
                        $LockCache["$SourceKey|$PkgNameFromLock"] = $Lock.packages[$Key]
                    }
                }
            }
            catch {
                Write-Verbose "Could not parse $LockPath`: $($_.Exception.Message)"
            }
        }

        foreach ($NpmEntry in $NpmEntries) {
            $SourceKey = $NpmEntry.Source -replace '/package\.json$', ''
            $CacheKey = "$SourceKey|$($NpmEntry.Name)"
            if ($LockCache.ContainsKey($CacheKey)) {
                $LockData = $LockCache[$CacheKey]
                if ($LockData.ContainsKey('license') -and $LockData.license)       { $NpmEntry.License   = $LockData.license }
                if ($LockData.ContainsKey('integrity') -and $LockData.integrity)   { $NpmEntry.Hash      = $LockData.integrity }
                if ($LockData.ContainsKey('resolved') -and $LockData.resolved)     { $NpmEntry.SourceUrl = $LockData.resolved }
                if ($LockData.ContainsKey('version') -and $LockData.version)       { $NpmEntry.Version   = $LockData.version }
            }
        }
    }

    # 7b. Python: batch pip show for license, author, description
    $PyEntries = @($Entries | Where-Object { $_.Type -eq 'python' })
    if ($PyEntries.Count -gt 0) {
        $PyCmd = if (Get-Command pip -ErrorAction SilentlyContinue) { 'pip' } else { 'pip3' }
        $PyNames = @($PyEntries | ForEach-Object { $_.Name -replace '\[.*\]', '' })
        try {
            $PipOutput = & $PyCmd show @PyNames 2>$null
            if ($PipOutput) {
                $PipBlocks = @{}
                $CurrentName = $null
                $CurrentBlock = @{}
                foreach ($PipLine in $PipOutput) {
                    if ($PipLine -match '^---') {
                        if ($CurrentName) { $PipBlocks[$CurrentName.ToLower()] = $CurrentBlock }
                        $CurrentName = $null
                        $CurrentBlock = @{}
                        continue
                    }
                    if ($PipLine -match '^([^:]+):\s*(.*)$') {
                        $FieldName = $Matches[1].Trim()
                        $FieldVal  = $Matches[2].Trim()
                        $CurrentBlock[$FieldName] = $FieldVal
                        if ($FieldName -eq 'Name') { $CurrentName = $FieldVal }
                    }
                }
                if ($CurrentName) { $PipBlocks[$CurrentName.ToLower()] = $CurrentBlock }

                foreach ($PyEntry in $PyEntries) {
                    $LookupName = ($PyEntry.Name -replace '\[.*\]', '').ToLower()
                    if ($PipBlocks.ContainsKey($LookupName)) {
                        $Info = $PipBlocks[$LookupName]
                        if ($Info.ContainsKey('License') -and $Info.License -and $Info.License -ne 'UNKNOWN') {
                            $PyEntry.License = $Info.License
                        }
                        if ($Info.ContainsKey('Author') -and $Info.Author -and $Info.Author -ne 'UNKNOWN') {
                            $PyEntry.Supplier = $Info.Author
                        }
                        if ($Info.ContainsKey('Summary') -and $Info.Summary -and $Info.Summary -ne 'UNKNOWN') {
                            $PyEntry.Description = $Info.Summary
                        }
                        if ($Info.ContainsKey('Version') -and $Info.Version) {
                            $PyEntry.Version = $Info.Version
                        }
                    }
                }
            }
        }
        catch {
            Write-Verbose "pip show failed: $($_.Exception.Message)"
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
                        $PkgName = $Entry.Name -replace '\[.*\]', ''
                        if (Get-Command pip -EA SilentlyContinue) { $PyCmd = 'pip' } else { $PyCmd = 'pip3' }
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
                                $AppDir = ($Pkg.Source -split '/')[0]
                                if ($AppDir -eq 'package.json') { $WorkDir = $RepoRoot } else { $WorkDir = Join-Path $RepoRoot $AppDir }
                                if ($PSCmdlet.ShouldProcess($Pkg.Name, "npm update in $AppDir")) {
                                    Push-Location $WorkDir
                                    npm update $Pkg.Name 2>&1 | Out-Null
                                    Pop-Location
                                    Write-Host "    Updated $($Pkg.Name)" -ForegroundColor Green
                                }
                            }
                            'python' {
                                $PkgName = $Pkg.Name -replace '\[.*\]', ''
                                if (Get-Command pip -EA SilentlyContinue) { $PyCmd = 'pip' } else { $PyCmd = 'pip3' }
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
    $BaseFields = @('Name', 'Version', 'Type', 'Scope', 'License', 'Supplier', 'InstalledVia', 'Source', 'SourceUrl', 'Description', 'Hash')
    if ($CheckUpdates) {
        $AllFields = @('Name', 'Version', 'LatestVersion', 'Status') + @('Type', 'Scope', 'License', 'Supplier', 'InstalledVia', 'Source', 'SourceUrl', 'Description', 'Hash')
        $OutputEntries = $Entries | Select-Object $AllFields
    }
    else {
        $OutputEntries = $Entries | Select-Object $BaseFields
    }

    switch ($Format) {
        'Table' {
            return $Entries
        }
        'Json' {
            return ($OutputEntries | ConvertTo-Json -Depth 5)
        }
        'Csv' {
            return ($OutputEntries | ConvertTo-Csv -NoTypeInformation)
        }
        'CycloneDX' {
            $Components = @($Entries | ForEach-Object {
                $PurlType = switch ($_.Type) {
                    'npm'       { 'npm' }
                    'npm-dev'   { 'npm' }
                    'python'    { 'pypi' }
                    'ps-module' { 'nuget' }
                    default     { 'generic' }
                }
                $Comp = [ordered]@{
                    type    = 'library'
                    name    = $_.Name
                    version = $_.Version
                    scope   = if ($_.Scope -eq 'development') { 'excluded' } else { 'required' }
                    purl    = "pkg:$PurlType/$($_.Name)@$($_.Version)"
                }
                if ($_.Description) { $Comp['description'] = $_.Description }
                if ($_.Supplier)    { $Comp['supplier'] = [ordered]@{ name = $_.Supplier } }
                if ($_.License)     { $Comp['licenses'] = @( [ordered]@{ license = [ordered]@{ id = $_.License } } ) }
                if ($_.Hash) {
                    $HashAlg = if ($_.Hash -match '^sha512-') { 'SHA-512' }
                               elseif ($_.Hash -match '^sha256-') { 'SHA-256' }
                               elseif ($_.Hash -match '^sha1-') { 'SHA-1' }
                               else { 'SHA-512' }
                    $HashVal = $_.Hash -replace '^sha\d+-', ''
                    $Comp['hashes'] = @( [ordered]@{ alg = $HashAlg; content = $HashVal } )
                }
                $ExtRefs = [System.Collections.Generic.List[hashtable]]::new()
                if ($_.SourceUrl) { $ExtRefs.Add([ordered]@{ type = 'distribution'; url = $_.SourceUrl }) }
                if ($ExtRefs.Count -gt 0) { $Comp['externalReferences'] = @($ExtRefs) }
                $Comp['properties'] = @(
                    [ordered]@{ name = 'source'; value = $_.Source }
                    [ordered]@{ name = 'component-type'; value = $_.Type }
                )
                $Comp
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
            $Packages = @($Entries | ForEach-Object {
                $PurlType = switch ($_.Type) {
                    'npm'       { 'npm' }
                    'npm-dev'   { 'npm' }
                    'python'    { 'pypi' }
                    'ps-module' { 'nuget' }
                    default     { 'generic' }
                }
                $SpdxPkg = [ordered]@{
                    SPDXID               = "SPDXRef-$($_.Name -replace '[^a-zA-Z0-9._-]', '-')"
                    name                 = $_.Name
                    versionInfo          = $_.Version
                    downloadLocation     = if ($_.SourceUrl) { $_.SourceUrl } else { 'NOASSERTION' }
                    filesAnalyzed        = $false
                    supplier             = if ($_.Supplier) { "Organization: $($_.Supplier)" } else { 'NOASSERTION' }
                    description          = if ($_.Description) { $_.Description } else { $null }
                    primaryPackagePurpose = if ($_.Scope -eq 'development') { 'DOCUMENTATION' } else { 'LIBRARY' }
                    externalRefs         = @(
                        [ordered]@{
                            referenceCategory = 'PACKAGE-MANAGER'
                            referenceType     = 'purl'
                            referenceLocator  = "pkg:$PurlType/$($_.Name)@$($_.Version)"
                        }
                    )
                }
                if ($_.License) {
                    $SpdxPkg['licenseConcluded'] = $_.License
                    $SpdxPkg['licenseDeclared']  = $_.License
                }
                else {
                    $SpdxPkg['licenseConcluded'] = 'NOASSERTION'
                    $SpdxPkg['licenseDeclared']  = 'NOASSERTION'
                }
                if ($_.Hash) {
                    $HashAlg = if ($_.Hash -match '^sha512-') { 'SHA512' }
                               elseif ($_.Hash -match '^sha256-') { 'SHA256' }
                               elseif ($_.Hash -match '^sha1-') { 'SHA1' }
                               else { 'SHA512' }
                    $HashVal = $_.Hash -replace '^sha\d+-', ''
                    $SpdxPkg['checksums'] = @( [ordered]@{ algorithm = $HashAlg; checksumValue = $HashVal } )
                }
                $SpdxPkg
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
