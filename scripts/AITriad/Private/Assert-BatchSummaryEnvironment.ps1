# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Assert-BatchSummaryEnvironment {
    <#
    .SYNOPSIS
        Invoke-BatchSummary STEP 0 (t/3910): require an API key (unless -DryRun) and
        the input paths, and create the output directories.
    .PARAMETER RequiredPath
        Paths that must exist (sources dir, taxonomy dir, version file).
    .PARAMETER EnsureDirectory
        Output directories to create when absent (summaries, conflicts). Honors the
        caller's -WhatIf through the inherited $WhatIfPreference.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Backend,
        [AllowEmptyString()][string]$ApiKey,
        [switch]$DryRun,
        [string[]]$RequiredPath = @(),
        [string[]]$EnsureDirectory = @()
    )

    if (-not $DryRun -and [string]::IsNullOrWhiteSpace($ApiKey)) {
        $EnvHint = switch ($Backend) {
            'gemini' { 'GEMINI_API_KEY' }
            'claude' { 'ANTHROPIC_API_KEY' }
            'groq'   { 'GROQ_API_KEY' }
            default  { 'AI_API_KEY' }
        }
        Write-Fail "No API key found. Set $EnvHint or AI_API_KEY."
        throw "No API key found for $Backend backend."
    }

    foreach ($req in $RequiredPath) {
        if (-not (Test-Path $req)) {
            Write-Fail "Required path not found: $req"
            throw "Required path not found: $req"
        }
    }

    foreach ($dir in $EnsureDirectory) {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }
}
