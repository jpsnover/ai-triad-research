# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Builds the local, provenance-tracked Talmudic moderator pilot corpus.
.DESCRIPTION
    Retrieves exact named editions from Sefaria Texts v3 and writes the corpus
    only beneath .local-data/talmudic-corpus in this repository.
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ManifestPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'lib\debate\talmudic-pilot-manifest.json'),

    [string]$OutputPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.local-data\talmudic-corpus\pilot-v1.json'),

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithCorpusError {
    param(
        [Parameter(Mandatory)] [string]$Goal,
        [Parameter(Mandatory)] [string]$Problem,
        [Parameter(Mandatory)] [string]$Location,
        [Parameter(Mandatory)] [string[]]$NextSteps
    )

    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine("  Goal:     $Goal")
    [Console]::Error.WriteLine("  Error:    $Problem")
    [Console]::Error.WriteLine("  Location: $Location")
    [Console]::Error.WriteLine('  Resolve:')
    for ($index = 0; $index -lt $NextSteps.Count; $index++) {
        [Console]::Error.WriteLine("  $($index + 1). $($NextSteps[$index])")
    }
    exit 1
}

function Get-PropertyValue {
    param(
        [AllowNull()] [object]$InputObject,
        [Parameter(Mandatory)] [string]$Name,
        [AllowNull()] [object]$Default = $null
    )

    if ($null -eq $InputObject) { return $Default }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function ConvertTo-FlatText {
    param([AllowNull()] [object]$Value)

    if ($null -eq $Value) { return '' }
    if ($Value -is [string]) { return $Value.Trim() }
    if ($Value -is [System.Collections.IEnumerable]) {
        $parts = @($Value | ForEach-Object { ConvertTo-FlatText -Value $_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        return ($parts -join ' ').Trim()
    }
    return ([string]$Value).Trim()
}

function Remove-HtmlMarkup {
    param([AllowNull()] [object]$Value)

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return [System.Net.WebUtility]::HtmlDecode(($text -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim())
}

function Get-SefariaVersion {
    param(
        [Parameter(Mandatory)] [string]$Reference,
        [Parameter(Mandatory)] [ValidateSet('hebrew', 'english')] [string]$Language,
        [Parameter(Mandatory)] [string]$VersionTitle,
        [Parameter(Mandatory)] [string]$ExpectedLicense
    )

    $encodedRef = [System.Uri]::EscapeDataString($Reference)
    $encodedVersion = [System.Uri]::EscapeDataString("$Language|$VersionTitle")
    $uri = "https://www.sefaria.org/api/v3/texts/$encodedRef`?version=$encodedVersion&return_format=text_only"
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 45
    }
    catch {
        Stop-WithCorpusError `
            -Goal 'Retrieve a named Sefaria edition' `
            -Problem $_.Exception.Message `
            -Location $uri `
            -NextSteps @('Confirm network access to www.sefaria.org', 'Rerun the initializer after the service is available')
    }

    $versions = @(Get-PropertyValue -InputObject $response -Name 'versions' -Default @())
    $matches = @($versions | Where-Object { (Get-PropertyValue -InputObject $_ -Name 'versionTitle') -eq $VersionTitle })
    if ($matches.Count -ne 1) {
        Stop-WithCorpusError `
            -Goal 'Select the exact configured Sefaria edition' `
            -Problem "Expected one '$VersionTitle' edition for '$Reference'; found $($matches.Count)" `
            -Location $uri `
            -NextSteps @('Inspect the edition names returned by Sefaria', 'Update the tracked pilot manifest only after reviewing the replacement edition')
    }

    $version = $matches[0]
    $license = [string](Get-PropertyValue -InputObject $version -Name 'license')
    if ($license -ne $ExpectedLicense) {
        Stop-WithCorpusError `
            -Goal 'Verify source licensing' `
            -Problem "Edition '$VersionTitle' returned license '$license'; expected '$ExpectedLicense'" `
            -Location $uri `
            -NextSteps @('Do not use or redistribute the changed edition', 'Review Sefaria licensing and update the manifest only after confirming reuse terms')
    }

    $text = ConvertTo-FlatText -Value (Get-PropertyValue -InputObject $version -Name 'text')
    if ([string]::IsNullOrWhiteSpace($text)) {
        Stop-WithCorpusError `
            -Goal 'Build a usable source card' `
            -Problem "Edition '$VersionTitle' returned no text for '$Reference'" `
            -Location $uri `
            -NextSteps @('Confirm the configured segment exists in that edition', 'Select a complete named edition and rerun')
    }

    return [ordered]@{
        language = [string](Get-PropertyValue -InputObject $version -Name 'language')
        version_title = $VersionTitle
        license = $license
        attribution = Remove-HtmlMarkup -Value (Get-PropertyValue -InputObject $version -Name 'versionNotes')
        source_url = [string](Get-PropertyValue -InputObject $version -Name 'versionSource')
        text = $text
    }
}

$repoRoot = [System.IO.Path]::GetFullPath((Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$resolvedManifest = [System.IO.Path]::GetFullPath($ManifestPath)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$allowedOutputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.local-data\talmudic-corpus'))
$allowedOutputPrefix = $allowedOutputRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutput.StartsWith($allowedOutputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithCorpusError `
        -Goal 'Keep downloaded corpus data inside the repository' `
        -Problem "Output path '$resolvedOutput' is outside '$allowedOutputRoot'" `
        -Location 'Initialize-TalmudicCorpus.ps1 output validation' `
        -NextSteps @('Use the default OutputPath', 'Choose a file beneath .local-data\talmudic-corpus')
}
if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
    Stop-WithCorpusError `
        -Goal 'Load the tracked pilot manifest' `
        -Problem "Manifest '$resolvedManifest' does not exist" `
        -Location 'Initialize-TalmudicCorpus.ps1 manifest validation' `
        -NextSteps @('Restore lib\debate\talmudic-pilot-manifest.json', 'Pass -ManifestPath with the tracked pilot manifest')
}
if ((Test-Path -LiteralPath $resolvedOutput -PathType Leaf) -and -not $Force) {
    Stop-WithCorpusError `
        -Goal 'Protect an existing local corpus' `
        -Problem "Corpus '$resolvedOutput' already exists" `
        -Location 'Initialize-TalmudicCorpus.ps1 output validation' `
        -NextSteps @('Use -Force to rebuild it from named editions', 'Keep the existing verified corpus')
}

try {
    $manifest = Get-Content -Raw -LiteralPath $resolvedManifest | ConvertFrom-Json
}
catch {
    Stop-WithCorpusError `
        -Goal 'Parse the pilot manifest' `
        -Problem $_.Exception.Message `
        -Location $resolvedManifest `
        -NextSteps @('Validate the JSON syntax', 'Restore the tracked manifest and rerun')
}

$entries = @(Get-PropertyValue -InputObject $manifest -Name 'entries' -Default @())
if ($entries.Count -ne 12) {
    Stop-WithCorpusError `
        -Goal 'Build the reviewed 12-reference pilot' `
        -Problem "Manifest contains $($entries.Count) entries; expected 12" `
        -Location $resolvedManifest `
        -NextSteps @('Restore the tracked pilot manifest', 'Review any corpus-scope change before rebuilding')
}

$cards = [System.Collections.Generic.List[object]]::new()
foreach ($entry in $entries) {
    $id = [string](Get-PropertyValue -InputObject $entry -Name 'id')
    $reference = [string](Get-PropertyValue -InputObject $entry -Name 'sefaria_ref')
    Write-Host "Retrieving $id — $([string](Get-PropertyValue -InputObject $entry -Name 'ref'))"

    $source = Get-SefariaVersion `
        -Reference $reference `
        -Language 'hebrew' `
        -VersionTitle ([string](Get-PropertyValue -InputObject $entry -Name 'source_version')) `
        -ExpectedLicense ([string](Get-PropertyValue -InputObject $entry -Name 'source_license'))
    $translation = Get-SefariaVersion `
        -Reference $reference `
        -Language 'english' `
        -VersionTitle ([string](Get-PropertyValue -InputObject $entry -Name 'translation_version')) `
        -ExpectedLicense ([string](Get-PropertyValue -InputObject $entry -Name 'translation_license'))

    $translationText = [string]$translation.text
    $excerptLength = [Math]::Min(700, $translationText.Length)
    $excerpt = $translationText.Substring(0, $excerptLength).Trim()
    if ($excerptLength -lt $translationText.Length) { $excerpt += '…' }

    $checksumInput = "$id`n$([string](Get-PropertyValue -InputObject $entry -Name 'ref'))`n$([string]$source.text)`n$translationText"
    $checksumBytes = [System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($checksumInput))
    $checksum = [System.Convert]::ToHexString($checksumBytes).ToLowerInvariant()

    $cards.Add([ordered]@{
        id = $id
        ref = [string](Get-PropertyValue -InputObject $entry -Name 'ref')
        sefaria_ref = $reference
        sefaria_url = "https://www.sefaria.org/$reference"
        layer = [string](Get-PropertyValue -InputObject $entry -Name 'layer')
        themes = @(Get-PropertyValue -InputObject $entry -Name 'themes' -Default @())
        disagreement_types = @(Get-PropertyValue -InputObject $entry -Name 'disagreement_types' -Default @())
        schemes = @(Get-PropertyValue -InputObject $entry -Name 'schemes' -Default @())
        usage_types = @(Get-PropertyValue -InputObject $entry -Name 'usage_types' -Default @())
        interpretive_summary = [string](Get-PropertyValue -InputObject $entry -Name 'interpretive_summary')
        counter_reading = [string](Get-PropertyValue -InputObject $entry -Name 'counter_reading')
        analogy_guardrails = @(Get-PropertyValue -InputObject $entry -Name 'analogy_guardrails' -Default @())
        review_status = [string](Get-PropertyValue -InputObject $entry -Name 'review_status')
        source = $source
        translation = $translation
        excerpt = $excerpt
        retrieved_at = (Get-Date).ToUniversalTime().ToString('o')
        checksum = $checksum
    })
}

$corpus = [ordered]@{
    version = 1
    name = [string](Get-PropertyValue -InputObject $manifest -Name 'name')
    review_status = [string](Get-PropertyValue -InputObject $manifest -Name 'review_status')
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    cards = @($cards)
}

if ($PSCmdlet.ShouldProcess($resolvedOutput, 'Write verified local Talmudic pilot corpus')) {
    $outputDirectory = Split-Path -Parent $resolvedOutput
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $outputDirectory -Force
    }
    $json = $corpus | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($resolvedOutput, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Wrote $($cards.Count) verified source cards to $resolvedOutput" -ForegroundColor Green
    Write-Host 'CC-BY-NC text is local-only and intended for this noncommercial research experiment.' -ForegroundColor Yellow
}
