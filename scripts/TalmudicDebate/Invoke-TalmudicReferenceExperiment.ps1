# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Runs matched Talmudic method-only and source-grounded debate pairs.
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(1, 20)]
    [int]$Pairs = 3,

    [string]$ConfigPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'debate-talmudic-openai.json'),

    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithExperimentError {
    param(
        [Parameter(Mandatory)] [string]$Problem,
        [Parameter(Mandatory)] [string]$Location,
        [Parameter(Mandatory)] [string[]]$NextSteps
    )

    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine('  Goal:     Run a matched Talmudic reference experiment')
    [Console]::Error.WriteLine("  Error:    $Problem")
    [Console]::Error.WriteLine("  Location: $Location")
    [Console]::Error.WriteLine('  Resolve:')
    for ($index = 0; $index -lt $NextSteps.Count; $index++) {
        [Console]::Error.WriteLine("  $($index + 1). $($NextSteps[$index])")
    }
    exit 1
}

function Set-JsonProperty {
    param(
        [Parameter(Mandatory)] [object]$InputObject,
        [Parameter(Mandatory)] [string]$Name,
        [AllowNull()] [object]$Value
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        $InputObject | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
    else {
        $property.Value = $Value
    }
}

function Get-NewestDebatePath {
    param([Parameter(Mandatory)] [datetime]$After)

    $files = @(Get-ChildItem -LiteralPath (Join-Path $script:repoRoot 'debates') -Filter '*-debate.json' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -ge $After.ToUniversalTime() } |
        Sort-Object LastWriteTimeUtc -Descending)
    if ($files.Count -eq 0) { return $null }
    return $files[0].FullName
}

$script:repoRoot = [System.IO.Path]::GetFullPath((Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$resolvedConfig = [System.IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $resolvedConfig -PathType Leaf)) {
    Stop-WithExperimentError `
        -Problem "Config '$resolvedConfig' does not exist" `
        -Location 'Invoke-TalmudicReferenceExperiment.ps1 config validation' `
        -NextSteps @('Pass -ConfigPath with an existing source-grounded config', 'Restore debate-talmudic-openai.json')
}

try {
    $baseConfig = Get-Content -Raw -LiteralPath $resolvedConfig | ConvertFrom-Json
}
catch {
    Stop-WithExperimentError `
        -Problem $_.Exception.Message `
        -Location $resolvedConfig `
        -NextSteps @('Correct the JSON syntax', 'Validate it with ConvertFrom-Json')
}

$referencesProperty = $baseConfig.PSObject.Properties['talmudicReferences']
if ($null -eq $referencesProperty -or $null -eq $referencesProperty.Value) {
    Stop-WithExperimentError `
        -Problem 'The base config has no talmudicReferences object' `
        -Location $resolvedConfig `
        -NextSteps @('Add the source-grounded configuration from the implementation plan', 'Use debate-talmudic-openai.json')
}

$corpusPathProperty = $referencesProperty.Value.PSObject.Properties['corpusPath']
if ($null -eq $corpusPathProperty) {
    Stop-WithExperimentError `
        -Problem 'The base config has no talmudicReferences.corpusPath' `
        -Location $resolvedConfig `
        -NextSteps @('Set corpusPath to ./.local-data/talmudic-corpus/pilot-v1.json')
}
$resolvedCorpus = if ([System.IO.Path]::IsPathRooted([string]$corpusPathProperty.Value)) {
    [System.IO.Path]::GetFullPath([string]$corpusPathProperty.Value)
}
else {
    [System.IO.Path]::GetFullPath((Join-Path $script:repoRoot ([string]$corpusPathProperty.Value)))
}
if (-not $PSCmdlet.ShouldProcess("$Pairs matched pair(s)", 'Initialize corpus if needed and run AI debate experiment')) { return }
if (-not (Test-Path -LiteralPath $resolvedCorpus -PathType Leaf)) {
    & (Join-Path $PSScriptRoot 'Initialize-TalmudicCorpus.ps1')
    if (-not (Test-Path -LiteralPath $resolvedCorpus -PathType Leaf)) {
        Stop-WithExperimentError `
            -Problem "Corpus initialization did not produce '$resolvedCorpus'" `
            -Location 'Invoke-TalmudicReferenceExperiment.ps1 corpus setup' `
            -NextSteps @('Run ./scripts/TalmudicDebate/Initialize-TalmudicCorpus.ps1 directly and inspect its actionable error')
    }
}

$experimentId = 'talmudic-reference-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$experimentRoot = Join-Path $script:repoRoot ".local-data\talmudic-experiments\$experimentId"
$results = [System.Collections.Generic.List[object]]::new()

$null = New-Item -ItemType Directory -Path $experimentRoot -Force

for ($pair = 1; $pair -le $Pairs; $pair++) {
    $pairResults = [ordered]@{ pair = $pair; method_only = $null; source_grounded = $null }
    foreach ($condition in @('method-only', 'source-grounded')) {
        $config = ($baseConfig | ConvertTo-Json -Depth 20 | ConvertFrom-Json)
        $enabled = $condition -eq 'source-grounded'
        Set-JsonProperty -InputObject $config.talmudicReferences -Name 'enabled' -Value $enabled
        Set-JsonProperty -InputObject $config -Name 'slug' -Value "$experimentId-pair$pair-$condition"
        Set-JsonProperty -InputObject $config -Name 'name' -Value "Talmudic reference experiment pair $pair — $condition"

        $conditionConfig = Join-Path $experimentRoot "pair-$pair-$condition.json"
        $conditionJson = $config | ConvertTo-Json -Depth 20
        [System.IO.File]::WriteAllText($conditionConfig, $conditionJson, [System.Text.UTF8Encoding]::new($false))

        Write-Host ''
        Write-Host "Pair $pair/$Pairs — $condition" -ForegroundColor Cyan
        $started = (Get-Date).ToUniversalTime().AddSeconds(-1)
        $runArguments = @{ ConfigPath = $conditionConfig }
        if ($NonInteractive) { $runArguments['NonInteractive'] = $true }
        & (Join-Path $PSScriptRoot 'Run-TalmudicDebate.ps1') @runArguments
        if ($LASTEXITCODE -ne 0) {
            Stop-WithExperimentError `
                -Problem "The $condition run in pair $pair failed with exit code $LASTEXITCODE" `
                -Location $conditionConfig `
                -NextSteps @('Review the actionable debate error above', 'Resolve it before comparing the pair')
        }
        $debatePath = Get-NewestDebatePath -After $started
        if ([string]::IsNullOrWhiteSpace([string]$debatePath)) {
            Stop-WithExperimentError `
                -Problem "The $condition run completed but no debate artifact was found" `
                -Location (Join-Path $script:repoRoot 'debates') `
                -NextSteps @('Inspect the CLI output directory', 'Confirm outputFormat includes JSON')
        }
        if ($enabled) { $pairResults.source_grounded = $debatePath } else { $pairResults.method_only = $debatePath }
    }
    $results.Add([pscustomobject]$pairResults)
}

$manifest = [ordered]@{
    experiment_id = $experimentId
    created_at = (Get-Date).ToUniversalTime().ToString('o')
    base_config = $resolvedConfig
    pairs = @($results)
    interpretation = 'Matched pairs reduce configuration differences but do not eliminate stochastic model variation. Review repeated pairs before causal claims.'
}
$manifestPath = Join-Path $experimentRoot 'experiment-results.json'
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host "Completed $Pairs matched pair(s)." -ForegroundColor Green
Write-Host "Experiment manifest: $manifestPath"
foreach ($result in $results) {
    Write-Host "Pair $($result.pair):"
    Write-Host "  Method-only:     $($result.method_only)"
    Write-Host "  Source-grounded: $($result.source_grounded)"
    Write-Host "  Review: .\scripts\TalmudicDebate\Review-TalmudicDebate.ps1 -Path '$($result.source_grounded)' -BaselinePath '$($result.method_only)'"
}
