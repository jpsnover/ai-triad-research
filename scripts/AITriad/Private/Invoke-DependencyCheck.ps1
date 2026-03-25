# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared dependency checking engine used by Install-AIDependencies and Test-Dependencies.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Invoke-DependencyCheck {
    <#
    .SYNOPSIS
        Core dependency checking engine. Returns a structured results object.
    .DESCRIPTION
        Checks all project dependencies, runs smoke tests, and returns a hashtable
        of results. Caller controls whether to fix (install) or just report.
    .PARAMETER Mode
        'install' — check + offer to fix.  'test' — check + version freshness, no fixing.
    .PARAMETER Fix
        When Mode=install, actually attempt to install missing deps.
    .PARAMETER Quiet
        Suppress passing checks in output.
    .PARAMETER SkipNode
        Skip Node.js checks.
    .PARAMETER SkipPython
        Skip Python checks.
    .PARAMETER RepoRoot
        Repository root path.
    #>
    [CmdletBinding()]
    param(
        [ValidateSet('install', 'test')]
        [string]$Mode = 'test',

        [switch]$Fix,
        [switch]$Quiet,
        [switch]$SkipNode,
        [switch]$SkipPython,
        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest

    # ─── Counters ─────────────────────────────────────────────────────────────
    $Ctx = @{
        Passed  = 0
        Warned  = 0
        Failed  = 0
        Fixed   = 0
        Outdated = 0
        Results = [System.Collections.Generic.List[PSObject]]::new()
    }

    # ─── Output helpers ───────────────────────────────────────────────────────
    # These need to close over $Quiet and $Ctx, so define as scriptblocks
    function DPass  { param([string]$M) $Ctx.Passed++;  if (-not $Quiet) { Write-Host "   `u{2713}  $M" -ForegroundColor Green }; $Ctx.Results.Add([PSCustomObject]@{ Status='pass'; Message=$M }) }
    function DWarn  { param([string]$M) $Ctx.Warned++;  Write-Host "   `u{26A0}  $M" -ForegroundColor Yellow; $Ctx.Results.Add([PSCustomObject]@{ Status='warn'; Message=$M }) }
    function DFail  { param([string]$M) $Ctx.Failed++;  Write-Host "   `u{2717}  $M" -ForegroundColor Red;    $Ctx.Results.Add([PSCustomObject]@{ Status='fail'; Message=$M }) }
    function DSkip  { param([string]$M) if (-not $Quiet) { Write-Host "   `u{2192}  $M" -ForegroundColor DarkGray } }
    function DFix   { param([string]$M) Write-Host "   `u{1F527}  $M" -ForegroundColor Cyan }
    function DStale { param([string]$M) $Ctx.Outdated++; Write-Host "   `u{2B06}  $M" -ForegroundColor Yellow; $Ctx.Results.Add([PSCustomObject]@{ Status='outdated'; Message=$M }) }
    function DSection { param([string]$M) Write-Host "`n  $M" -ForegroundColor White; Write-Host "  $('─' * 50)" -ForegroundColor DarkGray }

    $IsTestMode    = $Mode -eq 'test'
    $IsInstallMode = $Mode -eq 'install'

    # ─── Platform ─────────────────────────────────────────────────────────────
    $OnMac   = $IsMacOS -or ($PSVersionTable.OS -match 'Darwin')
    $OnLinux = $IsLinux -or ($PSVersionTable.OS -match 'Linux')
    $Platform = if ($OnMac) { 'macOS' } elseif ($OnLinux) { 'Linux' } else { 'Windows' }

    function Get-PkgMgr {
        if ($OnMac)    { if (Get-Command brew    -ErrorAction SilentlyContinue) { return 'brew' } }
        if ($OnLinux)  { if (Get-Command apt-get  -ErrorAction SilentlyContinue) { return 'apt' }
                         if (Get-Command dnf      -ErrorAction SilentlyContinue) { return 'dnf' }
                         if (Get-Command yum      -ErrorAction SilentlyContinue) { return 'yum' } }
        if ($IsWindows){ if (Get-Command winget   -ErrorAction SilentlyContinue) { return 'winget' }
                         if (Get-Command choco    -ErrorAction SilentlyContinue) { return 'choco' }
                         if (Get-Command scoop    -ErrorAction SilentlyContinue) { return 'scoop' } }
        return $null
    }

    function Install-Pkg {
        param([string]$Name, [hashtable]$PackageNames)
        if (-not $Fix) { return $false }
        $PM = Get-PkgMgr
        if (-not $PM) { DFail "Cannot auto-install '$Name' — no package manager found"; return $false }
        $PkgName = $PackageNames[$PM]
        if (-not $PkgName) { DFail "No package mapping for '$Name' on $PM"; return $false }
        DFix "Installing $Name via $PM ($PkgName)..."
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
            if ($LASTEXITCODE -eq 0) { $Ctx.Fixed++; DPass "$Name installed"; return $true }
            else { DFail "$Name installation failed (exit code $LASTEXITCODE)"; return $false }
        }
        catch { DFail "$Name installation failed: $_"; return $false }
    }

    # ═══════════════════════════════════════════════════════════════════════════
    $TitleVerb = if ($IsTestMode) { 'Dependency Test' } else { 'Dependency Check' }
    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan
    Write-Host "  AI Triad Research — $TitleVerb" -ForegroundColor White
    Write-Host "  Platform: $Platform  |  Mode: $Mode$(if ($Fix) { ' (fix)' })" -ForegroundColor Gray
    Write-Host "$('═' * 60)" -ForegroundColor Cyan

    # ── 1. POWERSHELL ─────────────────────────────────────────────────────────
    DSection 'POWERSHELL (required)'

    $PsVer = $PSVersionTable.PSVersion
    if ($PsVer.Major -ge 7) {
        DPass "PowerShell $PsVer"
    }
    else {
        DFail "PowerShell 7+ required (found $PsVer). Install from https://aka.ms/powershell"
    }

    # Module check — we're already running inside the module, just verify commands exist
    $CmdCount = (Get-Command -Module AITriad -ErrorAction SilentlyContinue).Count
    if ($CmdCount -gt 0) { DPass "AITriad module loaded ($CmdCount commands)" }
    else { DWarn 'AITriad module not loaded in current session' }

    # ── 2. GIT ────────────────────────────────────────────────────────────────
    DSection 'GIT (required)'

    if (Get-Command git -ErrorAction SilentlyContinue) {
        try {
            $GitVer = (git --version 2>&1) -replace 'git version ', ''
            $GitRoot = git -C $RepoRoot rev-parse --show-toplevel 2>&1
            if ($LASTEXITCODE -eq 0) {
                DPass "git $GitVer"
            }
            else {
                DWarn "git $GitVer installed but repo check failed"
            }
        }
        catch { DWarn "git found but smoke test failed: $_" }
    }
    else {
        DFail 'git not found'
        if ($IsInstallMode) {
            Install-Pkg -Name 'git' -PackageNames @{
                brew = 'git'; apt = 'git'; dnf = 'git'; winget = 'Git.Git'; choco = 'git'
            }
        }
    }

    # ── 3. AI API KEYS ────────────────────────────────────────────────────────
    DSection 'AI API KEYS (at least one required)'

    $HasAnyKey = $false

    if ($env:GEMINI_API_KEY) {
        try {
            $Uri = "https://generativelanguage.googleapis.com/v1beta/models?key=$($env:GEMINI_API_KEY)"
            $R = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 10 -ErrorAction Stop
            $ModelCount = @($R.models).Count
            DPass "GEMINI_API_KEY valid ($ModelCount models available)"
            $HasAnyKey = $true
        }
        catch {
            $SC = $_.Exception.Response.StatusCode.value__
            if ($SC -eq 400 -or $SC -eq 403) { DFail "GEMINI_API_KEY invalid (HTTP $SC)" }
            else { DWarn "GEMINI_API_KEY set but API unreachable"; $HasAnyKey = $true }
        }
    }
    else { DWarn 'GEMINI_API_KEY not set (primary backend)' }

    if ($env:ANTHROPIC_API_KEY) {
        try {
            $Hdrs = @{ 'x-api-key' = $env:ANTHROPIC_API_KEY; 'anthropic-version' = '2023-06-01'; 'content-type' = 'application/json' }
            $Body = @{ model = 'claude-3-5-haiku-20241022'; max_tokens = 10; messages = @(@{ role = 'user'; content = 'Say OK' }) } | ConvertTo-Json -Depth 5
            $null = Invoke-RestMethod -Uri 'https://api.anthropic.com/v1/messages' -Method Post -Headers $Hdrs -Body $Body -TimeoutSec 15 -ErrorAction Stop
            DPass 'ANTHROPIC_API_KEY valid'
            $HasAnyKey = $true
        }
        catch {
            $SC = $_.Exception.Response.StatusCode.value__
            if ($SC -eq 401) { DFail 'ANTHROPIC_API_KEY invalid (HTTP 401)' }
            else { DWarn "ANTHROPIC_API_KEY set but smoke test failed"; $HasAnyKey = $true }
        }
    }
    else { DSkip 'ANTHROPIC_API_KEY not set (optional)' }

    if ($env:GROQ_API_KEY) {
        try {
            $Hdrs = @{ 'Authorization' = "Bearer $($env:GROQ_API_KEY)"; 'Content-Type' = 'application/json' }
            $null = Invoke-RestMethod -Uri 'https://api.groq.com/openai/v1/models' -Method Get -Headers $Hdrs -TimeoutSec 10 -ErrorAction Stop
            DPass 'GROQ_API_KEY valid'
            $HasAnyKey = $true
        }
        catch {
            $SC = $_.Exception.Response.StatusCode.value__
            if ($SC -eq 401) { DFail 'GROQ_API_KEY invalid (HTTP 401)' }
            else { DWarn "GROQ_API_KEY set but smoke test failed"; $HasAnyKey = $true }
        }
    }
    else { DSkip 'GROQ_API_KEY not set (optional)' }

    if (-not $HasAnyKey -and $env:AI_API_KEY) {
        DWarn 'AI_API_KEY (fallback) set but cannot verify which backend it targets'
        $HasAnyKey = $true
    }
    if (-not $HasAnyKey) {
        DFail 'No AI API key configured. Set GEMINI_API_KEY or run Register-AIBackend.'
    }

    # ── 4. NODE.JS & NPM ─────────────────────────────────────────────────────
    if (-not $SkipNode) {
        DSection 'NODE.JS & NPM (required for desktop apps)'

        $HasNode = $false
        if (Get-Command node -ErrorAction SilentlyContinue) {
            try {
                $NodeVer = (node --version 2>&1).Trim()
                $Major = [int]($NodeVer -replace '^v', '' -split '\.' | Select-Object -First 1)
                if ($Major -ge 20) {
                    $NodeResult = node -e "console.log(JSON.stringify({ok:true,version:process.version}))" 2>&1
                    $NodeJson = $NodeResult | ConvertFrom-Json
                    if ($NodeJson.ok) {
                        DPass "Node.js $($NodeJson.version) (>= v20 required)"
                        $HasNode = $true
                    }
                    else { DWarn "Node.js $NodeVer — smoke test failed" }
                }
                else { DFail "Node.js $NodeVer too old (v20+ required)" }
            }
            catch { DWarn "Node.js found but smoke test failed: $_" }
        }
        else {
            DFail 'Node.js not found'
            if ($IsInstallMode) {
                Install-Pkg -Name 'node' -PackageNames @{
                    brew = 'node@22'; apt = 'nodejs'; dnf = 'nodejs'
                    winget = 'OpenJS.NodeJS.LTS'; choco = 'nodejs-lts'; scoop = 'nodejs-lts'
                }
            }
        }

        if (Get-Command npm -ErrorAction SilentlyContinue) {
            $NpmVer = (npm --version 2>&1).Trim()
            DPass "npm $NpmVer"
        }
        else { DFail 'npm not found' }

        # Electron apps
        $ElectronApps = @('taxonomy-editor', 'poviewer', 'summary-viewer', 'edge-viewer')
        foreach ($App in $ElectronApps) {
            $AppDir   = Join-Path $RepoRoot $App
            $PkgJson  = Join-Path $AppDir 'package.json'
            $NodeMods = Join-Path $AppDir 'node_modules'

            if (-not (Test-Path $PkgJson)) { DWarn "$App — package.json not found"; continue }

            if (Test-Path $NodeMods) {
                $ModCount = (Get-ChildItem -Path $NodeMods -Directory | Measure-Object).Count
                DPass "$App — node_modules present ($ModCount packages)"

                # Test mode: check for outdated packages
                if ($IsTestMode -and $HasNode) {
                    try {
                        Push-Location $AppDir
                        $OutdatedRaw = npm outdated --json 2>$null
                        Pop-Location
                        if ($OutdatedRaw) {
                            $Outdated = $OutdatedRaw | ConvertFrom-Json
                            $OutdatedCount = $Outdated.PSObject.Properties.Count
                            if ($OutdatedCount -gt 0) {
                                DStale "$App — $OutdatedCount outdated package(s) (run 'npm update' in $App/ to update)"
                                # Show top 3
                                $Shown = 0
                                foreach ($Prop in $Outdated.PSObject.Properties) {
                                    if ($Shown -ge 3) { break }
                                    $Pkg = $Prop.Value
                                    $CurVer = if ($Pkg.PSObject.Properties['current']) { $Pkg.current } else { '?' }
                                    $WantVer = if ($Pkg.PSObject.Properties['wanted']) { $Pkg.wanted } else { '?' }
                                    Write-Host "         $($Prop.Name): $CurVer -> $WantVer" -ForegroundColor DarkGray
                                    $Shown++
                                }
                                if ($OutdatedCount -gt 3) {
                                    Write-Host "         ... and $($OutdatedCount - 3) more" -ForegroundColor DarkGray
                                }
                            }
                        }
                    }
                    catch { }  # npm outdated can fail gracefully
                }
            }
            else {
                DWarn "$App — node_modules missing"
                if ($IsInstallMode -and $Fix -and $HasNode) {
                    DFix "Running npm install in $App..."
                    Push-Location $AppDir
                    try {
                        npm install 2>&1 | Out-Null
                        if ($LASTEXITCODE -eq 0) { $Ctx.Fixed++; DPass "$App — npm install succeeded" }
                        else { DFail "$App — npm install failed (exit code $LASTEXITCODE)" }
                    }
                    catch { DFail "$App — npm install failed: $_" }
                    finally { Pop-Location }
                }
                else { DSkip "Run 'npm install' in $App/" }
            }
        }
    }
    else {
        DSection 'NODE.JS & NPM (skipped)'
        DSkip 'Skipped via -SkipNode'
    }

    # ── 5. DOCUMENT CONVERSION ────────────────────────────────────────────────
    DSection 'DOCUMENT CONVERSION (recommended)'

    if (Get-Command pandoc -ErrorAction SilentlyContinue) {
        try {
            $PandocVer = (pandoc --version 2>&1 | Select-Object -First 1) -replace 'pandoc ', ''
            $TestResult = '<p>Hello</p>' | pandoc -f html -t markdown_strict --wrap=none 2>&1
            if ($TestResult -match 'Hello') { DPass "pandoc $PandocVer (smoke test passed)" }
            else { DWarn "pandoc $PandocVer — conversion smoke test failed" }
        }
        catch { DWarn "pandoc found but smoke test failed: $_" }
    }
    else {
        DWarn 'pandoc not found — HTML/DOCX conversion will use basic fallback'
        if ($IsInstallMode) {
            Install-Pkg -Name 'pandoc' -PackageNames @{
                brew = 'pandoc'; apt = 'pandoc'; dnf = 'pandoc'
                winget = 'JohnMacFarlane.Pandoc'; choco = 'pandoc'; scoop = 'pandoc'
            }
        }
    }

    if (Get-Command pdftotext -ErrorAction SilentlyContinue) {
        try {
            $PdfVer = (pdftotext -v 2>&1 | Select-Object -First 1)
            DPass "pdftotext available ($PdfVer)"
        }
        catch { DPass 'pdftotext available' }
    }
    elseif (Get-Command mutool -ErrorAction SilentlyContinue) {
        DPass 'mutool available (fallback PDF extractor)'
    }
    else {
        DWarn 'Neither pdftotext nor mutool found — PDF extraction will be limited'
        if ($IsInstallMode) {
            Install-Pkg -Name 'poppler' -PackageNames @{
                brew = 'poppler'; apt = 'poppler-utils'; dnf = 'poppler-utils'; yum = 'poppler-utils'
            }
        }
    }

    # ── 6. PYTHON & EMBEDDINGS ────────────────────────────────────────────────
    if (-not $SkipPython) {
        DSection 'PYTHON & EMBEDDINGS (optional)'

        $PythonCmd = $null
        foreach ($Cmd in @('python3', 'python')) {
            if (Get-Command $Cmd -ErrorAction SilentlyContinue) {
                try {
                    $PyVer = & $Cmd --version 2>&1
                    $PyMajor = [int](("$PyVer" -replace 'Python ', '') -split '\.' | Select-Object -First 1)
                    if ($PyMajor -ge 3) {
                        $PyTest = & $Cmd -c "import json; print(json.dumps({'ok': True}))" 2>&1
                        $PyJson = $PyTest | ConvertFrom-Json
                        if ($PyJson.ok) { $PythonCmd = $Cmd; DPass "$Cmd — $PyVer"; break }
                    }
                }
                catch { }
            }
        }

        if (-not $PythonCmd) {
            DWarn 'Python 3 not found — Update-TaxEmbeddings will not work'
            if ($IsInstallMode) {
                Install-Pkg -Name 'python3' -PackageNames @{
                    brew = 'python@3'; apt = 'python3'; dnf = 'python3'
                    winget = 'Python.Python.3.12'; choco = 'python3'; scoop = 'python'
                }
            }
        }
        else {
            $ReqFile = Join-Path $RepoRoot 'scripts' 'requirements.txt'
            if (Test-Path $ReqFile) {
                try {
                    $ImportTest = & $PythonCmd -c "import sentence_transformers; print(sentence_transformers.__version__)" 2>$null
                    if ($LASTEXITCODE -eq 0 -and $ImportTest) {
                        DPass "sentence-transformers $("$ImportTest".Trim())"

                        # Test mode: check if pip packages are outdated
                        if ($IsTestMode) {
                            try {
                                $PipOutdated = & $PythonCmd -m pip list --outdated --format=json 2>$null
                                if ($LASTEXITCODE -eq 0 -and $PipOutdated) {
                                    $OutdatedPkgs = $PipOutdated | ConvertFrom-Json
                                    # Filter to packages in our requirements.txt
                                    $ReqNames = @(Get-Content $ReqFile | Where-Object { $_ -match '^\w' } | ForEach-Object { ($_ -split '[>=<]')[0].Trim().ToLower() })
                                    $Relevant = @($OutdatedPkgs | Where-Object { $_.name.ToLower() -in $ReqNames })
                                    if ($Relevant.Count -gt 0) {
                                        DStale "$($Relevant.Count) Python package(s) outdated (run '$PythonCmd -m pip install -U -r scripts/requirements.txt' to update)"
                                        foreach ($Pkg in $Relevant | Select-Object -First 3) {
                                            Write-Host "         $($Pkg.name): $($Pkg.version) -> $($Pkg.latest_version)" -ForegroundColor DarkGray
                                        }
                                        if ($Relevant.Count -gt 3) {
                                            Write-Host "         ... and $($Relevant.Count - 3) more" -ForegroundColor DarkGray
                                        }
                                    }
                                }
                            }
                            catch { }  # pip outdated can fail gracefully
                        }
                    }
                    else {
                        DWarn 'sentence-transformers not installed'
                        if ($IsInstallMode -and $Fix) {
                            DFix 'Installing Python requirements...'
                            & $PythonCmd -m pip install -r $ReqFile 2>&1 | Out-Null
                            if ($LASTEXITCODE -eq 0) { $Ctx.Fixed++; DPass 'Python requirements installed' }
                            else { DFail 'pip install failed' }
                        }
                        else { DSkip "Run '$PythonCmd -m pip install -r scripts/requirements.txt'" }
                    }
                }
                catch { DWarn "Could not check Python packages: $_" }
            }

            $EmbFile = Get-TaxonomyDir 'embeddings.json'
            if (Test-Path $EmbFile) {
                try {
                    $EmbData = Get-Content -Raw -Path $EmbFile | ConvertFrom-Json -Depth 3
                    $EmbCount = if ($EmbData.PSObject.Properties['node_count']) { $EmbData.node_count } else { '?' }
                    DPass "embeddings.json present ($EmbCount node embeddings)"

                    # Test mode: check if embeddings are stale (more taxonomy nodes than embeddings)
                    if ($IsTestMode -and $EmbCount -ne '?') {
                        $TotalTaxNodes = 0
                        foreach ($PovKey in @('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')) {
                            $E = $script:TaxonomyData[$PovKey]
                            if ($E) { $TotalTaxNodes += @($E.nodes).Count }
                        }
                        if ($TotalTaxNodes -gt [int]$EmbCount) {
                            DStale "embeddings.json has $EmbCount embeddings but taxonomy has $TotalTaxNodes nodes — run Update-TaxEmbeddings"
                        }
                    }
                }
                catch {
                    $EmbSize = [Math]::Round((Get-Item $EmbFile).Length / 1MB, 1)
                    DPass "embeddings.json present (${EmbSize}MB)"
                }
            }
            else { DSkip 'embeddings.json not yet generated — run Update-TaxEmbeddings' }
        }
    }
    else {
        DSection 'PYTHON & EMBEDDINGS (skipped)'
        DSkip 'Skipped via -SkipPython'
    }

    # ── 7. DOCKER & NEO4J ────────────────────────────────────────────────────
    DSection 'DOCKER & NEO4J (optional — graph database)'

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            $DockerVer = ((docker --version 2>&1) -replace 'Docker version ', '' -replace ',.*', '').Trim()
            if ($DockerVer) {
                $DockerPing = docker info 2>&1
                if ($LASTEXITCODE -eq 0) {
                    DPass "Docker $DockerVer (daemon running)"
                    $Neo4jContainer = docker ps -a --filter 'name=ai-triad-neo4j' --format '{{.Status}}' 2>&1
                    if ($Neo4jContainer) {
                        if ($Neo4jContainer -match 'Up') { DPass "Neo4j container running" }
                        else { DWarn "Neo4j container exists but stopped — docker start ai-triad-neo4j" }
                    }
                    else { DSkip 'Neo4j container not created — run Install-GraphDatabase' }
                }
                else { DWarn "Docker $DockerVer installed but daemon not running" }
            }
            else { DWarn 'Docker found but version check failed' }
        }
        catch { DWarn "Docker smoke test failed: $_" }
    }
    else {
        DSkip 'Docker not installed (only needed for Neo4j graph database)'
    }

    # ── 8. DATA INTEGRITY ────────────────────────────────────────────────────
    DSection 'DATA INTEGRITY'

    $TaxDir    = Get-TaxonomyDir
    $TaxFiles  = @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'cross-cutting.json')
    $TotalNodes = 0
    foreach ($TF in $TaxFiles) {
        $TFPath = Join-Path $TaxDir $TF
        if (Test-Path $TFPath) {
            try { $TData = Get-Content -Raw -Path $TFPath | ConvertFrom-Json; $TotalNodes += @($TData.nodes).Count }
            catch { DFail "$TF — failed to parse JSON" }
        }
        else { DFail "$TF — not found in taxonomy/Origin/" }
    }
    if ($TotalNodes -gt 0) { DPass "Taxonomy valid ($TotalNodes nodes across $($TaxFiles.Count) POVs)" }

    $EdgesPath = Join-Path $TaxDir 'edges.json'
    if (Test-Path $EdgesPath) {
        try { $EData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json; DPass "edges.json valid ($(@($EData.edges).Count) edges)" }
        catch { DFail 'edges.json — failed to parse' }
    }
    else { DSkip 'edges.json not yet generated' }

    foreach ($DirInfo in @(
        @{ Name = 'summaries'; Filter = '*.json'; Type = 'File' }
        @{ Name = 'sources';   Filter = $null;     Type = 'Directory' }
        @{ Name = 'conflicts'; Filter = '*.json'; Type = 'File' }
    )) {
        $DirPath = Join-Path $RepoRoot $DirInfo.Name
        if (Test-Path $DirPath) {
            $Params = @{ Path = $DirPath }
            if ($DirInfo.Filter) { $Params['Filter'] = $DirInfo.Filter; $Params['File'] = $true }
            else { $Params['Directory'] = $true }
            $Count = (Get-ChildItem @Params).Count
            DPass "$($DirInfo.Name)/ — $Count items"
        }
        else { DSkip "$($DirInfo.Name)/ not found" }
    }

    # ── SUMMARY ──────────────────────────────────────────────────────────────
    Write-Host "`n$('═' * 60)" -ForegroundColor Cyan
    Write-Host "  RESULTS" -ForegroundColor White
    Write-Host "$('═' * 60)" -ForegroundColor Cyan

    $TotalChecks = $Ctx.Passed + $Ctx.Warned + $Ctx.Failed
    Write-Host "   Passed  : $($Ctx.Passed)" -ForegroundColor Green
    Write-Host "   Warnings: $($Ctx.Warned)" -ForegroundColor Yellow
    Write-Host "   Failed  : $($Ctx.Failed)" -ForegroundColor $(if ($Ctx.Failed -gt 0) { 'Red' } else { 'Green' })
    if ($Ctx.Outdated -gt 0) {
        Write-Host "   Outdated: $($Ctx.Outdated)" -ForegroundColor Yellow
    }
    if ($Ctx.Fixed -gt 0) {
        Write-Host "   Fixed   : $($Ctx.Fixed)" -ForegroundColor Cyan
    }
    Write-Host "   Total   : $TotalChecks checks" -ForegroundColor Gray

    if ($Ctx.Failed -gt 0) {
        Write-Host "`n  Some required dependencies are missing." -ForegroundColor Red
        if ($IsInstallMode -and -not $Fix) {
            Write-Host "  Re-run with -Fix to attempt automatic installation." -ForegroundColor Yellow
        }
    }
    elseif ($Ctx.Outdated -gt 0) {
        Write-Host "`n  All dependencies present but $($Ctx.Outdated) item(s) are outdated." -ForegroundColor Yellow
        Write-Host "  NOT updating automatically — review the items above and update manually." -ForegroundColor Yellow
    }
    elseif ($Ctx.Warned -gt 0) {
        Write-Host "`n  All required dependencies present. Some optional features may be limited." -ForegroundColor Yellow
    }
    else {
        Write-Host "`n  All dependencies satisfied and up to date." -ForegroundColor Green
    }

    Write-Host "$('═' * 60)`n" -ForegroundColor Cyan

    return $Ctx
}
