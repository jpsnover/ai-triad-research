<#
.SYNOPSIS
    Parses literal-string env entries from the baseEnv block in main.bicep.

.DESCRIPTION
    Extracts entries where the value is a pure single-quoted string literal —
    no Bicep interpolation (`${...}`), no parameter/resource references.
    These are the only entries that can be statically compared against the
    ExpectedEnvVars table in deploy-azure.yml (t/2631).

    Skipped by design (not static-comparable):
      ALLOWED_ORIGINS             — Bicep string interpolation
      AZURE_KEYVAULT_URL          — resource property reference
      AZURE_STORAGE_ACCOUNT_URL   — resource property reference
      AUTH_DISABLED / AUTH_OPTIONAL / ADMIN_USERS
      GIT_SYNC_ENABLED / GITHUB_* — parameter references (overridden by -ForStaging)
      APPLICATIONINSIGHTS_*       — resource property reference

.PARAMETER BicepPath
    Path to deploy/azure/main.bicep. Defaults to the canonical location
    relative to this script's repo root.

.PARAMETER ForStaging
    Also parse var stagingEnvOverrides and merge into the result (staging values
    win over baseEnv). Use when syncing or verifying the staging container app.

.OUTPUTS
    [hashtable] mapping env-var name → literal string value.
    Exits non-zero if the baseEnv block is not found.

.EXAMPLE
    $env = . ./operations/devops/Get-BicepBaseEnv.ps1
    $env['NODE_ENV']   # 'production'

.EXAMPLE
    $env = . ./operations/devops/Get-BicepBaseEnv.ps1 -ForStaging
    $env['TAXONOMY_CACHE_DIR']   # '/mnt/staging-state/cache'
#>
[CmdletBinding()]
param(
    [string]$BicepPath,
    [switch]$ForStaging
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $BicepPath) {
    $repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $BicepPath = Join-Path $repoRoot 'deploy/azure/main.bicep'
}

if (-not (Test-Path $BicepPath)) {
    throw "main.bicep not found at: $BicepPath"
}

$content = Get-Content $BicepPath -Raw

# Locate the baseEnv block: var baseEnv = [ ... ]
# Capture everything between the opening '[' and the matching ']'
if ($content -notmatch '(?s)var baseEnv\s*=\s*\[(.*?)\]') {
    Write-Error "baseEnv block not found in $BicepPath"
    exit 1
}
$block = $Matches[1]

# Match entries where the value is a pure single-quoted string literal.
# Excludes: values with ${...} (interpolation), or values without quotes (param refs).
$literalPattern = @"
\{\s*name:\s*'([^']+)',\s*value:\s*'([^'\$\{\}]*)'\s*\}
"@.Trim()

$result = @{}
$block | Select-String -Pattern $literalPattern -AllMatches | ForEach-Object {
    foreach ($m in $_.Matches) {
        $name  = $m.Groups[1].Value
        $value = $m.Groups[2].Value
        $result[$name] = $value
    }
}

if ($ForStaging) {
    if ($content -match '(?s)var stagingEnvOverrides\s*=\s*\[(.*?)\]') {
        $stagingBlock = $Matches[1]
        $stagingBlock | Select-String -Pattern $literalPattern -AllMatches | ForEach-Object {
            foreach ($m in $_.Matches) {
                $result[$m.Groups[1].Value] = $m.Groups[2].Value
            }
        }
    } else {
        Write-Warning "stagingEnvOverrides block not found in $BicepPath — only baseEnv entries returned"
    }
}

return $result
