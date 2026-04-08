# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Deploy the Taxonomy Editor to Azure Container Apps.
.DESCRIPTION
    One-command deployment: creates resource group, deploys Bicep template,
    seeds initial data from GitHub, and configures CORS.
.PARAMETER ResourceGroup
    Azure resource group name (created if it doesn't exist).
.PARAMETER Location
    Azure region. Default: eastus.
.PARAMETER GeminiApiKey
    Gemini API key (prompted securely if not provided).
.PARAMETER AnthropicApiKey
    Anthropic API key (optional).
.PARAMETER GroqApiKey
    Groq API key (optional).
.PARAMETER ContainerImage
    Container image reference. Default: ghcr.io/jpsnover/taxonomy-editor:latest
.PARAMETER SeedData
    Clone ai-triad-data into the Azure Files share on first deploy.
.PARAMETER SkipLogin
    Skip az login check (for CI/CD environments).
.EXAMPLE
    ./deploy.ps1 -ResourceGroup ai-triad -GeminiApiKey $env:GEMINI_API_KEY
.EXAMPLE
    ./deploy.ps1 -ResourceGroup ai-triad -SeedData
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroup,

    [string]$Location = 'eastus',

    [securestring]$GeminiApiKey,

    [securestring]$AnthropicApiKey,

    [securestring]$GroqApiKey,

    [string]$ContainerImage = 'ghcr.io/jpsnover/taxonomy-editor:latest',

    [switch]$SeedData,

    [switch]$SkipLogin
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-OK   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

function ConvertFrom-SecureStringPlain {
    param([securestring]$Secure)
    if (-not $Secure -or $Secure.Length -eq 0) { return '' }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

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

# Prompt for Gemini key if not provided
if (-not $GeminiApiKey -or $GeminiApiKey.Length -eq 0) {
    $GeminiApiKey = Read-Host -Prompt 'Enter Gemini API key' -AsSecureString
}

$geminiPlain    = ConvertFrom-SecureStringPlain $GeminiApiKey
$anthropicPlain = ConvertFrom-SecureStringPlain $AnthropicApiKey
$groqPlain      = ConvertFrom-SecureStringPlain $GroqApiKey

if ([string]::IsNullOrEmpty($geminiPlain)) {
    throw 'Gemini API key is required. Provide -GeminiApiKey or enter when prompted.'
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

$deployResult = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $bicepFile `
    --parameters geminiApiKey=$geminiPlain `
    --parameters anthropicApiKey=$anthropicPlain `
    --parameters groqApiKey=$groqPlain `
    --parameters containerImage=$ContainerImage `
    --output json | ConvertFrom-Json

$appUrl     = $deployResult.properties.outputs.appUrl.value
$appName    = $deployResult.properties.outputs.appName.value
$storageAcct = $deployResult.properties.outputs.storageAccountName.value
$shareName  = $deployResult.properties.outputs.fileShareName.value

Write-OK "Deployed: $appUrl"

# ── Configure CORS ──

Write-Step 'Setting CORS to restrict to app URL'

az containerapp update `
    --name $appName `
    --resource-group $ResourceGroup `
    --set-env-vars "ALLOWED_ORIGINS=$appUrl" `
    --output none

Write-OK "CORS restricted to $appUrl"

# ── Seed data (optional) ──

if ($SeedData) {
    Write-Step 'Seeding taxonomy data from GitHub'

    # Get storage key
    $storageKey = (az storage account keys list `
        --account-name $storageAcct `
        --resource-group $ResourceGroup `
        --output json | ConvertFrom-Json)[0].value

    # Clone data repo to temp, then upload to Azure Files
    $tempDir = Join-Path ([IO.Path]::GetTempPath()) "aitriad-data-$(Get-Random)"
    try {
        git clone --depth 1 https://github.com/jpsnover/ai-triad-data.git $tempDir

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
Write-Host '╔══════════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║  Taxonomy Editor deployed successfully!                     ║' -ForegroundColor Green
Write-Host '╠══════════════════════════════════════════════════════════════╣' -ForegroundColor Green
Write-Host "║  URL:     $appUrl" -ForegroundColor Green
Write-Host "║  RG:      $ResourceGroup" -ForegroundColor Green
Write-Host "║  Storage: $storageAcct/$shareName" -ForegroundColor Green
Write-Host '╠══════════════════════════════════════════════════════════════╣' -ForegroundColor Green
Write-Host '║  Next steps:                                                ║' -ForegroundColor Green
Write-Host '║  1. Open the URL above in your browser                     ║' -ForegroundColor Green
Write-Host '║  2. Add auth:  az containerapp auth update ...             ║' -ForegroundColor Green
Write-Host '║  3. Seed data: ./deploy.ps1 ... -SeedData                  ║' -ForegroundColor Green
Write-Host '╚══════════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
