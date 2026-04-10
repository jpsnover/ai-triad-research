# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Prompt {
    <#
    .SYNOPSIS
        Loads a .prompt file from the Prompts/ directory with optional placeholder replacement.
    .DESCRIPTION
        Reads a prompt template from scripts/AITriad/Prompts/<Name>.prompt, caches
        the raw text in $script:PromptCache, and optionally substitutes {{KEY}}
        placeholders with values from the -Replacements hashtable.
    .PARAMETER Name
        Base name of the prompt file (without .prompt extension).
    .PARAMETER Replacements
        Hashtable of placeholder replacements. Keys are matched as {{KEY}} in the
        prompt text (case-sensitive).
    .EXAMPLE
        Get-Prompt -Name 'pov-summary-system'
    .EXAMPLE
        Get-Prompt -Name 'triad-dialogue-system' -Replacements @{ AGENT_NAME = 'Prometheus'; POV_LABEL = 'Accelerationist' }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Name,

        [hashtable]$Replacements = @{},

        [switch]$AllowUnresolved
    )

    if (-not (Get-Variable -Name 'PromptCache' -Scope Script -ErrorAction SilentlyContinue)) {
        $script:PromptCache = @{}
    }

    if (-not $script:PromptCache.ContainsKey($Name)) {
        $PromptPath = Join-Path (Join-Path $script:ModuleRoot 'Prompts') "$Name.prompt"
        if (-not (Test-Path $PromptPath)) {
            throw "Prompt file not found: $PromptPath"
        }
        $script:PromptCache[$Name] = (Get-Content -Path $PromptPath -Raw -Encoding UTF8).TrimEnd()
    }

    $Text = $script:PromptCache[$Name]

    foreach ($Key in $Replacements.Keys) {
        $Text = $Text -replace [regex]::Escape("{{$Key}}"), $Replacements[$Key]
    }

    # Warn if any placeholders remain unresolved (unless caller expects to substitute later)
    if (-not $AllowUnresolved -and $Text -match '\{\{[A-Z_]+\}\}') {
        $Remaining = [regex]::Matches($Text, '\{\{[A-Z_]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
        Write-Warning "Unresolved placeholders in prompt '$Name': $($Remaining -join ', '). These will appear as literal text in the AI prompt."
    }

    return $Text
}