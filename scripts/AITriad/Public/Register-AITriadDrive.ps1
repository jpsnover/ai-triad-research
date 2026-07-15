# Copyright (c) 2026 Snover International Consulting LLC. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Register-AITriadDrive {
    <#
    .SYNOPSIS
        Creates a PSDrive named AITriad that exposes the taxonomy as a navigable hierarchy.
    .DESCRIPTION
        Compiles the AITriad NavigationCmdletProvider (C#) and mounts the taxonomy
        data directory as AITriad:\{POV}\{Category}\{NodeId}.

        Hierarchy:
          AITriad:\
          ├── Accelerationist\
          │   ├── Beliefs\
          │   ├── Desires\
          │   └── Intentions\
          ├── Safetyist\
          └── Skeptic\

        Supports Get-ChildItem (dir), Get-Item, Set-Location (cd), tab-completion,
        and Get-Content (returns node description text).
    .PARAMETER TaxonomyPath
        Path to the taxonomy Origin directory containing the POV JSON files.
        Defaults to Get-TaxonomyDir (resolved from .aitriad.json).
    .PARAMETER Force
        Re-compile the provider even if the DLL already exists.
    .EXAMPLE
        Register-AITriadDrive
        cd AITriad:\Accelerationist\Desires
        dir
    .EXAMPLE
        Get-Item AITriad:\Safetyist\Beliefs\saf-beliefs-001
    .EXAMPLE
        Get-Content AITriad:\Skeptic\Desires\skp-desires-001
    .LINK
        Show-AITriadHelp
    .LINK
        Install-AIDependencies
    .LINK
        Install-AITriadData
    .LINK
        Install-GraphDatabase
    .LINK
        Test-Dependencies
    #>
    [CmdletBinding()]
    param(
        [string]$TaxonomyPath,

        [switch]$Force
    )

    # Resolve taxonomy directory
    if ([string]::IsNullOrWhiteSpace($TaxonomyPath)) {
        $TaxonomyPath = Get-TaxonomyDir
    }
    $TaxonomyPath = [System.IO.Path]::GetFullPath($TaxonomyPath)
    if (-not (Test-Path $TaxonomyPath)) {
        throw (New-ActionableError `
            -Goal 'mount AITriad: PSDrive' `
            -Problem "Taxonomy directory not found: $TaxonomyPath" `
            -Location 'Register-AITriadDrive' `
            -NextSteps 'Set $env:AI_TRIAD_DATA_ROOT or pass -TaxonomyPath explicitly' `
            -PassThru)
    }

    # If drive already exists, remove it first (allows re-registration)
    if (Get-PSDrive -Name AITriad -ErrorAction SilentlyContinue) {
        if (-not $Force) {
            Write-Verbose 'AITriad: drive already mounted — use -Force to re-register'
            return
        }
        Remove-PSDrive -Name AITriad -Force
    }

    # Locate provider project
    $ProviderDir = Join-Path $script:ModuleRoot 'Provider'
    $CsprojPath  = Join-Path $ProviderDir 'AITriadProvider.csproj'
    $CsPath      = Join-Path $ProviderDir 'AITriadProvider.cs'

    foreach ($Required in @($CsprojPath, $CsPath)) {
        if (-not (Test-Path $Required)) {
            throw (New-ActionableError `
                -Goal 'compile AITriad provider' `
                -Problem "Required file not found: $Required" `
                -Location 'Register-AITriadDrive' `
                -NextSteps 'Ensure Provider/AITriadProvider.cs and .csproj exist in the module directory' `
                -PassThru)
        }
    }

    # Version the output dir by source hash to avoid DLL-locking on recompile.
    # A new CS file produces a new hash → fresh output dir → no lock conflict.
    $CsHash   = (Get-FileHash -Path $CsPath -Algorithm SHA256).Hash.Substring(0, 12)
    $OutputDir = Join-Path ([System.IO.Path]::GetTempPath()) "AITriad-Provider-$CsHash"
    $DllPath   = Join-Path $OutputDir 'AITriadProvider.dll'

    $NeedCompile = -not (Test-Path $DllPath)
    if ($NeedCompile) {
        $DotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
        if (-not $DotnetCmd) {
            throw (New-ActionableError `
                -Goal 'compile AITriad provider' `
                -Problem 'dotnet CLI not found — .NET SDK is required to compile the provider' `
                -Location 'Register-AITriadDrive' `
                -NextSteps 'Install the .NET SDK from https://dot.net/download' `
                -PassThru)
        }

        Write-Verbose "AITriad: compiling provider → $DllPath"
        $BuildOutput = dotnet publish $CsprojPath `
            --configuration Release `
            --output $OutputDir `
            --nologo `
            --verbosity quiet 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw (New-ActionableError `
                -Goal 'compile AITriad provider' `
                -Problem "dotnet publish failed (exit $LASTEXITCODE): $($BuildOutput | Out-String)" `
                -Location $CsprojPath `
                -NextSteps 'Check the C# source for syntax errors; run dotnet build manually for diagnostics' `
                -PassThru)
        }
    }

    # Import the compiled DLL as a module (registers the provider)
    try {
        Import-Module $DllPath -Force -ErrorAction Stop
    }
    catch {
        throw (New-ActionableError `
            -Goal 'load AITriad provider assembly' `
            -Problem "Import-Module failed: $($_.Exception.Message)" `
            -Location $DllPath `
            -NextSteps 'Try Register-AITriadDrive -Force to recompile, or restart PowerShell if the DLL is locked' `
            -PassThru)
    }

    # Load format views AFTER the provider DLL so they take precedence
    $FormatFile = Join-Path $script:ModuleRoot 'Formats' 'Taxonomy.Format.ps1xml'
    if (Test-Path $FormatFile) {
        Update-FormatData -PrependPath $FormatFile -ErrorAction SilentlyContinue
    }

    # Create the PSDrive (empty Root to avoid filesystem path resolution;
    # actual data path passed via Description for the provider's NewDrive)
    New-PSDrive -Name AITriad `
                -PSProvider AITriad `
                -Root '' `
                -Scope Global `
                -Description $TaxonomyPath |
        Out-Null

    # Summary
    $TotalNodes = 0
    $PovList = @()
    foreach ($File in Get-ChildItem -Path $TaxonomyPath -Filter '*.json' -File) {
        $BaseName = $File.BaseName.ToLower()
        if ($BaseName -in 'embeddings', 'edges', 'policy_actions', '_archived_edges',
            'lineage_categories', 'interpretation_embeddings', 'source_evidence_index',
            'similarity-cache', 'situations') { continue }
        try {
            $Json = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
            if ($Json.PSObject.Properties['nodes']) {
                $TotalNodes += @($Json.nodes).Count
                $PovList += $File.BaseName
            }
        }
        catch { }
    }

    Write-Host "AITriad: drive mounted — $($PovList.Count) POVs, $TotalNodes nodes" -ForegroundColor Green
    Write-Host "  cd AITriad:\ to explore" -ForegroundColor DarkGray
}
