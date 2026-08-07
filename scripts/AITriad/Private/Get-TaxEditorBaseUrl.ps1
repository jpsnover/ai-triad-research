# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Canonical production URL for the taxonomy-editor Azure Container App (t/1291).
# Dot-sourced by AITriad.psm1 — do NOT export.
#
# Single source of truth used by every -BaseUrl default across the module.
# Env-var override lets ops re-point cmdlets at a staging revision without
# editing code (e.g., $env:TAXEDITOR_BASE_URL = 'https://taxonomy-editor--stg.-.io').

$script:TaxEditorBaseUrlDefault = 'https://ai-rosetta-stone.yellowbush-aeda037d.eastus.azurecontainerapps.io'

function Get-TaxEditorBaseUrl {
    <#
    .SYNOPSIS
        Returns the canonical production URL for the taxonomy-editor Azure Container App.
    .DESCRIPTION
        Reads $env:TAXEDITOR_BASE_URL when set; otherwise returns the compiled-in
        canonical URL. Every cmdlet with a -BaseUrl parameter should default it
        to (Get-TaxEditorBaseUrl) so a single edit here (or an env-var override)
        re-points the whole module at a different revision.

        Trailing slash is stripped so consumers can safely do "$BaseUrl/api/foo".
    .EXAMPLE
        Get-TaxEditorBaseUrl
        # https://ai-rosetta-stone.yellowbush-aeda037d.eastus.azurecontainerapps.io

        $env:TAXEDITOR_BASE_URL = 'https://taxonomy-editor--staging.eastus.azurecontainerapps.io'
        Get-TaxEditorBaseUrl
        # https://taxonomy-editor--staging.eastus.azurecontainerapps.io
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    Set-StrictMode -Version Latest

    $override = $env:TAXEDITOR_BASE_URL
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return $override.TrimEnd('/')
    }
    return $script:TaxEditorBaseUrlDefault.TrimEnd('/')
}
