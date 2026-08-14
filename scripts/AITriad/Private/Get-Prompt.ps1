# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Prompt {
    <#
    .SYNOPSIS
        Loads a .prompt file from the Prompts/ directory with optional placeholder replacement.
    .DESCRIPTION
        Reads a prompt template from a Prompts directory, caches the raw text in
        $script:PromptCache, and optionally substitutes {{KEY}} placeholders with
        values from the -Replacements hashtable. By default loads from
        scripts/AITriad/Prompts/; pass -PromptsDir to override (e.g. lib/oped/prompts/).
    .PARAMETER Name
        Base name of the prompt file (without .prompt extension).
    .PARAMETER Replacements
        Hashtable of placeholder replacements. Keys are matched as {{KEY}} in the
        prompt text (case-sensitive).
    .PARAMETER PromptsDir
        Absolute path to the directory containing .prompt files. Defaults to the
        module's own Prompts/ folder. Override for shared artifacts in other locations
        (e.g. lib/oped/prompts/). Cache is keyed per-directory so two callers
        targeting different directories do not collide.
    .EXAMPLE
        Get-Prompt -Name 'pov-summary-system'
    .EXAMPLE
        Get-Prompt -Name 'triad-dialogue-system' -Replacements @{ AGENT_NAME = 'Accelerationist'; POV_LABEL = 'Accelerationist' }
    .EXAMPLE
        Get-Prompt -Name 'op-ed-generation-system' -PromptsDir $OPedPromptsDir -Replacements @{ POV_LABEL = 'Safetyist' }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Name,

        [hashtable]$Replacements = @{},

        [switch]$AllowUnresolved,

        [string]$PromptsDir = (Join-Path $script:ModuleRoot 'Prompts')
    )

    if (-not (Get-Variable -Name 'PromptCache' -Scope Script -ErrorAction SilentlyContinue)) {
        $script:PromptCache = @{}
    }

    $CacheKey = "$PromptsDir::$Name"
    if (-not $script:PromptCache.ContainsKey($CacheKey)) {
        $PromptPath = Join-Path $PromptsDir "$Name.prompt"
        if (-not (Test-Path $PromptPath)) {
            throw "Prompt file not found: $PromptPath"
        }
        $script:PromptCache[$CacheKey] = (Get-Content -Path $PromptPath -Raw -Encoding UTF8).TrimEnd()
    }

    $Text = $script:PromptCache[$CacheKey]

    foreach ($Key in $Replacements.Keys) {
        $Text = $Text -replace [regex]::Escape("{{$Key}}"), $Replacements[$Key]
    }

    # t/1334 — fragment injection: for any {{name}} placeholder that had no caller
    # value, check for Prompts/<name>.fragment.prompt and inline its contents.
    # Single-pass / non-recursive: fragments are NOT re-scanned for nested placeholders.
    # Caller replacements above have already run, so they take precedence.
    if (-not (Get-Variable -Name 'PromptFragmentCache' -Scope Script -ErrorAction SilentlyContinue)) {
        $script:PromptFragmentCache = @{}
    }
    $FragmentMatches = [regex]::Matches($Text, '\{\{([A-Za-z0-9_-]+)\}\}')
    $FragmentReplacements = @{}
    foreach ($M in $FragmentMatches) {
        $FragName = $M.Groups[1].Value
        if ($FragmentReplacements.ContainsKey($FragName)) { continue }
        # Caller-supplied wins (redundant guard — the replacement above already ran, but
        # this documents intent explicitly)
        if ($Replacements.ContainsKey($FragName)) { continue }
        $FragCacheKey = "$PromptsDir::$FragName"
        if (-not $script:PromptFragmentCache.ContainsKey($FragCacheKey)) {
            $FragPath = Join-Path $PromptsDir "$FragName.fragment.prompt"
            if (Test-Path $FragPath) {
                $script:PromptFragmentCache[$FragCacheKey] = (Get-Content -Path $FragPath -Raw -Encoding UTF8).TrimEnd()
            } else {
                # Cache a $null sentinel so we don't stat the disk again for missing fragments
                $script:PromptFragmentCache[$FragCacheKey] = $null
            }
        }
        $FragContent = $script:PromptFragmentCache[$FragCacheKey]
        if ($null -ne $FragContent) {
            $FragmentReplacements[$FragName] = $FragContent
        }
    }
    foreach ($FragName in $FragmentReplacements.Keys) {
        $Text = $Text -replace [regex]::Escape("{{$FragName}}"), $FragmentReplacements[$FragName]
    }

    # Warn if any placeholders remain unresolved (unless caller expects to substitute later)
    if (-not $AllowUnresolved -and $Text -match '\{\{[A-Za-z0-9_-]+\}\}') {
        $Remaining = [regex]::Matches($Text, '\{\{[A-Za-z0-9_-]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
        Write-Warning "Unresolved placeholders in prompt '$Name': $($Remaining -join ', '). These will appear as literal text in the AI prompt."
    }

    return $Text
}