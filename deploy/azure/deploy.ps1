# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Deploy the Taxonomy Editor to Azure Container Apps.
.DESCRIPTION
    One-command deployment: creates resource group, deploys Bicep template,
    seeds initial data from GitHub, and configures CORS.

    BYOK model: No API keys are passed to Azure. Users enter their own
    Gemini/Claude/Groq API keys through the app's UI after deployment.
    Keys are encrypted and stored on the Azure Files data volume.
.PARAMETER ResourceGroup
    Azure resource group name (created if it doesn't exist).
.PARAMETER Location
    Azure region. Default: eastus.
.PARAMETER ContainerImage
    Container image reference. Default: ghcr.io/jpsnover/taxonomy-editor:latest
.PARAMETER SeedData
    Clone ai-triad-data into the Azure Files share on first deploy.
.PARAMETER SkipLogin
    Skip az login check (for CI/CD environments).
.PARAMETER EnableGitSync
    Turn on the Phase-2 GitHub sync feature. Requires a GitHub App (or PAT)
    plus the data directory being a real git clone.
.PARAMETER GitHubRepo
    Target repo in owner/repo form (e.g. "jpsnover/ai-triad-data").
.PARAMETER GitHubAppId
    GitHub App numeric ID.
.PARAMETER GitHubAppInstallationId
    Installation ID of the App on the target repo/org.
.PARAMETER GitHubAppPrivateKeySecretName
    Name of the Key Vault secret holding the App's PEM private key.
    Upload it once with:
      az keyvault secret set --vault-name <vault> --name <name> --file key.pem
.PARAMETER GitHubWebhookSecret
    HMAC shared secret for the GitHub webhook. When set, the server verifies
    X-Hub-Signature-256 and flags "upstream updated" for the UI on merged PRs.
.EXAMPLE
    ./deploy.ps1 -ResourceGroup ai-triad
.EXAMPLE
    ./deploy.ps1 -ResourceGroup ai-triad -SeedData
.EXAMPLE
    ./deploy.ps1 -ResourceGroup ai-triad `
        -EnableGitSync `
        -GitHubRepo 'jpsnover/ai-triad-data' `
        -GitHubAppId '123456' `
        -GitHubAppInstallationId '7890123' `
        -GitHubAppPrivateKeySecretName 'github-app-private-key'
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroup,

    [string]$Location = 'eastus',

    [string]$ContainerImage = 'ghcr.io/jpsnover/taxonomy-editor:latest',

    [switch]$SeedData,

    [switch]$SkipLogin,

    # GitHub sync (Phase-2/3) options. Leave empty to keep the feature off.
    [switch]$EnableGitSync,
    [string]$GitHubRepo = '',
    [string]$GitHubAppId = '',
    [string]$GitHubAppInstallationId = '',
    [string]$GitHubAppPrivateKeySecretName = '',
    [string]$GitHubWebhookSecret = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-OK   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

# ── Pre-flight checks ──

Write-Step 'Checking prerequisites'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI (az) is not installed. Install from https://aka.ms/install-azure-cli'
}

if (-not $SkipLogin) {
    $acct = az account show 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $acct) {
        Write-Warn 'Not logged in to Azure. Running az login...'
        az login
        $acct = az account show | ConvertFrom-Json
    }
    Write-OK "Logged in as $($acct.user.name) (subscription: $($acct.name))"
}

# ── Create resource group ──

Write-Step "Ensuring resource group '$ResourceGroup' in $Location"
$rgExists = az group exists --name $ResourceGroup 2>$null
if ($rgExists -eq 'false') {
    az group create --name $ResourceGroup --location $Location --output none
    Write-OK "Created resource group '$ResourceGroup'"
} else {
    Write-OK "Resource group '$ResourceGroup' already exists"
}

# ── Deploy Bicep template ──

Write-Step 'Deploying infrastructure (Container Apps + Storage)'

$bicepFile = Join-Path $PSScriptRoot 'main.bicep'
if (-not (Test-Path $bicepFile)) {
    throw "Bicep template not found at $bicepFile"
}

$deployParams = @("containerImage=$ContainerImage")
if ($EnableGitSync) { $deployParams += 'gitSyncEnabled=1' }
if ($GitHubRepo)                    { $deployParams += "githubRepo=$GitHubRepo" }
if ($GitHubAppId)                   { $deployParams += "githubAppId=$GitHubAppId" }
if ($GitHubAppInstallationId)       { $deployParams += "githubAppInstallationId=$GitHubAppInstallationId" }
if ($GitHubAppPrivateKeySecretName) { $deployParams += "githubAppPrivateKeySecretName=$GitHubAppPrivateKeySecretName" }
if ($GitHubWebhookSecret)           { $deployParams += "githubWebhookSecret=$GitHubWebhookSecret" }

$deployResult = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $bicepFile `
    --parameters @deployParams `
    --output json | ConvertFrom-Json

$appUrl      = $deployResult.properties.outputs.appUrl.value
$appName     = $deployResult.properties.outputs.appName.value
$storageAcct = $deployResult.properties.outputs.storageAccountName.value
$shareName   = $deployResult.properties.outputs.fileShareName.value

Write-OK "Deployed: $appUrl"

# ── Seed data (optional) ──

if ($SeedData) {
    Write-Step 'Seeding taxonomy data from GitHub'

    # Get storage key
    $storageKey = (az storage account keys list `
        --account-name $storageAcct `
        --resource-group $ResourceGroup `
        --output json | ConvertFrom-Json)[0].value

    # Clone data repo to temp, prune unneeded files, then upload to Azure Files
    $tempDir = Join-Path ([IO.Path]::GetTempPath()) "aitriad-data-$(Get-Random)"
    try {
        git clone --depth 1 https://github.com/jpsnover/ai-triad-data.git $tempDir

        # Remove large files not needed by the web app (~900 MB savings)
        # Raw PDFs/DOCX — only used by poviewer for on-demand PDF analysis
        $rawDirs = Get-ChildItem -Path (Join-Path $tempDir 'sources') -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'raw' } |
            Where-Object { Test-Path $_ }
        foreach ($dir in $rawDirs) {
            Remove-Item $dir -Recurse -Force
            Write-OK "  Pruned: $($dir | Split-Path -Parent | Split-Path -Leaf)/raw/"
        }

        # Remove unused/research artifacts
        $excludeDirs = @('conflicts-consolidated', 'conflicts-original', 'qbaf-conflicts', 'migrations', '.git')
        foreach ($name in $excludeDirs) {
            $path = Join-Path $tempDir $name
            if (Test-Path $path) {
                Remove-Item $path -Recurse -Force
                Write-OK "  Pruned: $name/"
            }
        }

        # Remove research/calibration artifacts
        Get-ChildItem -Path $tempDir -Filter 'q0-calibration*' -ErrorAction SilentlyContinue |
            Remove-Item -Force
        Get-ChildItem -Path $tempDir -Filter 'token-calibration*' -ErrorAction SilentlyContinue |
            Remove-Item -Force
        Get-ChildItem -Path $tempDir -Filter '_*_migration_manifest.json' -ErrorAction SilentlyContinue |
            Remove-Item -Force

        $sizeMB = [math]::Round((Get-ChildItem $tempDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
        Write-OK "Data pruned to $sizeMB MB (excluded raw PDFs, research artifacts)"

        Write-OK 'Uploading data to Azure Files share...'
        az storage file upload-batch `
            --destination $shareName `
            --source $tempDir `
            --account-name $storageAcct `
            --account-key $storageKey `
            --output none

        Write-OK 'Data seeded successfully'
    }
    finally {
        if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
    }
}

# ── Summary ──

Write-Host ''
Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host '  Taxonomy Editor deployed successfully!' -ForegroundColor Green
Write-Host '══════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host "  URL:     $appUrl" -ForegroundColor White
Write-Host "  RG:      $ResourceGroup" -ForegroundColor White
Write-Host "  Storage: $storageAcct/$shareName" -ForegroundColor White
Write-Host ''
Write-Host '  Next steps:' -ForegroundColor Cyan
Write-Host '  1. Open the URL above in your browser' -ForegroundColor White
Write-Host '  2. Enter your Gemini API key when prompted (BYOK)' -ForegroundColor White
Write-Host '  3. Seed data: ./deploy.ps1 ... -SeedData' -ForegroundColor White
Write-Host '  4. Add auth: az containerapp auth update ...' -ForegroundColor White
Write-Host ''
Write-Host '  API keys are entered in-app and encrypted on the data volume.' -ForegroundColor Yellow
Write-Host '  No keys are stored in Azure configuration or deployment.' -ForegroundColor Yellow
Write-Host ''
