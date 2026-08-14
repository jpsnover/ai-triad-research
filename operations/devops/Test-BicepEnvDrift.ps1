<#
.SYNOPSIS
    CI drift-detector: compares Bicep baseEnv literal entries against
    deploy-azure.yml ExpectedEnvVars. Exits non-zero on any mismatch.

.DESCRIPTION
    Calls Get-BicepBaseEnv.ps1 to extract the literal-string env vars from
    main.bicep, then parses the ExpectedEnvVars hashtable from deploy-azure.yml
    for the same keys and compares. Non-literal Bicep entries (interpolation /
    param refs) are skipped by the parser and never compared here (t/2631).

    Gate proof arms expected by TL:
      Fire: change a Bicep literal (e.g. NODE_ENV -> 'wrong') without updating
            ExpectedEnvVars -> this script exits 1 with ::error:: annotations.
      Pass: both files in sync -> exits 0 with "PASSED" line.

.PARAMETER BicepPath
    Path to deploy/azure/main.bicep. Defaults to repo-relative location.

.PARAMETER DeployYmlPath
    Path to .github/workflows/deploy-azure.yml. Defaults to repo-relative.
#>
[CmdletBinding()]
param(
    [string]$BicepPath,
    [string]$DeployYmlPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $BicepPath)     { $BicepPath     = Join-Path $repoRoot 'deploy/azure/main.bicep' }
if (-not $DeployYmlPath) { $DeployYmlPath = Join-Path $repoRoot '.github/workflows/deploy-azure.yml' }

# ── 1. Parse Bicep literal entries ──────────────────────────────────────────
$parserScript  = Join-Path $PSScriptRoot 'Get-BicepBaseEnv.ps1'
$bicepLiterals = . $parserScript -BicepPath $BicepPath

if ($bicepLiterals.Keys.Count -eq 0) {
    Write-Host "::error::Get-BicepBaseEnv returned zero entries — check main.bicep baseEnv block"
    exit 1
}

# ── 2. Parse ExpectedEnvVars block from deploy-azure.yml ────────────────────
# Strategy: scan line-by-line; enter block on '-ExpectedEnvVars @{',
# exit on a line whose only non-whitespace content is '}' (the closing brace).
# Match only KEY = 'simple-literal-value' lines — GitHub expression values
# (containing $, {, }) are skipped; we only compare the Bicep-literal keys.
$yamlLines = Get-Content $DeployYmlPath
$inBlock   = $false
$yamlEnv   = @{}

foreach ($line in $yamlLines) {
    if (-not $inBlock) {
        if ($line -match '-ExpectedEnvVars\s*@\{') { $inBlock = $true }
        continue
    }
    if ($line -match '^\s*\}\s*$') { break }  # closing brace of the hashtable
    # Simple literal: KEY = 'value'  (no $, {, } in value)
    if ($line -match "^\s*(\w+)\s*=\s*'([^'{}\$]*)'\s*(?:#.*)?$") {
        $yamlEnv[$Matches[1]] = $Matches[2]
    }
}

if ($yamlEnv.Keys.Count -eq 0) {
    Write-Host "::error::No simple-literal entries parsed from deploy-azure.yml ExpectedEnvVars — block missing or format changed"
    exit 1
}

# ── 3. Compare ───────────────────────────────────────────────────────────────
$pass = $true
$rows = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($key in ($bicepLiterals.Keys | Sort-Object)) {
    $bicepVal = $bicepLiterals[$key]
    $yamlVal  = $yamlEnv[$key]

    if ($null -eq $yamlVal) {
        $rows.Add([PSCustomObject]@{ Key=$key; Bicep=$bicepVal; ExpectedEnvVars='(missing)'; Status='FAIL' })
        Write-Host "::error file=.github/workflows/deploy-azure.yml::DRIFT: '$key' is in Bicep baseEnv ('$bicepVal') but missing from ExpectedEnvVars table"
        $pass = $false
    } elseif ($yamlVal -ne $bicepVal) {
        $rows.Add([PSCustomObject]@{ Key=$key; Bicep=$bicepVal; ExpectedEnvVars=$yamlVal; Status='FAIL' })
        Write-Host "::error file=.github/workflows/deploy-azure.yml::DRIFT: '$key' — Bicep='$bicepVal' vs ExpectedEnvVars='$yamlVal'"
        $pass = $false
    } else {
        $rows.Add([PSCustomObject]@{ Key=$key; Bicep=$bicepVal; ExpectedEnvVars=$yamlVal; Status='OK' })
    }
}

$rows | Format-Table Key, Bicep, ExpectedEnvVars, Status -AutoSize | Out-String | Write-Host

if (-not $pass) {
    Write-Host ''
    Write-Host "::error::Bicep baseEnv is out of sync with deploy-azure.yml ExpectedEnvVars."
    Write-Host "::error::Fix: update both files in the same PR. See t/2631."
    exit 1
}

Write-Host "Drift check PASSED — $($bicepLiterals.Keys.Count) literal keys in sync."
