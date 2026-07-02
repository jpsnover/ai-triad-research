# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# UsageID registry loader + template renderer (t/1261).
# Dot-sourced by AITriad.psm1 — do NOT export.
#
# PS mirror of the TypeScript lib/ai-client/usageRegistry.ts (t/1259/t/1260).
# Reads ai-usages.json at the code repo root, resolves _extends chains, and
# renders {{var}} templates. Consumers pass a UsageID + values hashtable and
# get back a resolved parameter bag suitable for splatting to Invoke-AIApi.

$script:UsageRegistryCache          = $null
$script:UsageRegistryCacheTimestamp = $null
$script:UsageRegistryCachePath      = $null

function Get-UsageRegistryPath {
    [CmdletBinding()]
    [OutputType([string])]
    param()
    $root = Get-CodeRoot
    return Join-Path $root 'ai-usages.json'
}

function Get-UsageRegistry {
    <#
    .SYNOPSIS
        Loads (or returns cached) ai-usages.json content as a PSCustomObject.
    .DESCRIPTION
        Reads $repoRoot/ai-usages.json, caches parsed structure. Invalidates
        on file mtime change. Returns the raw parsed object; consumers should
        use Get-UsageConfig for per-id lookup with _extends resolution.
    .PARAMETER Force
        Bypass the cache and re-read from disk.
    .PARAMETER Path
        Override the source file path. Defaults to repo-root/ai-usages.json.
    #>
    [CmdletBinding()]
    param(
        [switch]$Force,
        [string]$Path
    )
    Set-StrictMode -Version Latest

    if ($Path) { $p = $Path } else { $p = Get-UsageRegistryPath }

    if (-not (Test-Path $p)) {
        throw (New-ActionableError -PassThru `
            -Goal 'Load ai-usages registry' `
            -Problem "ai-usages.json not found at $p" `
            -Location 'Get-UsageRegistry' `
            -NextSteps @(
                'Verify the code repo root contains ai-usages.json',
                'Check Get-CodeRoot resolves the expected path',
                'Restore ai-usages.json from git if the file was deleted'
            ))
    }

    $mtime = (Get-Item $p).LastWriteTimeUtc
    if (-not $Force -and $script:UsageRegistryCache -and $script:UsageRegistryCacheTimestamp -eq $mtime -and $script:UsageRegistryCachePath -eq $p) {
        return $script:UsageRegistryCache
    }
    try {
        $raw = Get-Content -Raw -Path $p -Encoding utf8
        $parsed = $raw | ConvertFrom-Json
    } catch {
        throw (New-ActionableError -PassThru `
            -Goal 'Parse ai-usages registry' `
            -Problem "Failed to parse ai-usages.json: $($_.Exception.Message)" `
            -Location 'Get-UsageRegistry' `
            -NextSteps @(
                'Validate JSON with: Get-Content ai-usages.json | ConvertFrom-Json',
                'Check for trailing commas or unbalanced brackets'
            ))
    }
    $script:UsageRegistryCache          = $parsed
    $script:UsageRegistryCacheTimestamp = $mtime
    $script:UsageRegistryCachePath      = $p
    return $parsed
}

function Clear-UsageRegistryCache {
    [CmdletBinding()]
    param()
    $script:UsageRegistryCache          = $null
    $script:UsageRegistryCacheTimestamp = $null
    $script:UsageRegistryCachePath      = $null
}

function Get-UsageConfig {
    <#
    .SYNOPSIS
        Resolves a UsageID to its fully-materialized config with _extends chain applied.
    .DESCRIPTION
        Walks the _extends chain (single-level per convention — cycles refused
        with an ActionableError). Child fields override parent fields. Skips
        the top-level _schema_version and _doc keys.

        Returns a hashtable with keys matching the on-disk schema (model,
        temperature, maxTokens, timeoutMs, jsonMode, responseSchema,
        systemMessage, systemMessageTemplate, message, messageTemplate,
        tools, tags, description).
    .PARAMETER UsageId
        The usage identifier (e.g., 'enrichment.metadata-extraction').
    .PARAMETER Registry
        Optional pre-loaded registry (from Get-UsageRegistry). Loaded lazily otherwise.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UsageId,

        [object]$Registry
    )
    Set-StrictMode -Version Latest

    if (-not $Registry) { $Registry = Get-UsageRegistry }
    if (-not $Registry.PSObject.Properties[$UsageId]) {
        throw (New-ActionableError -PassThru `
            -Goal 'Resolve usage config' `
            -Problem "UsageID '$UsageId' not found in ai-usages.json" `
            -Location 'Get-UsageConfig' `
            -NextSteps @(
                'Check spelling: Invoke-AIByUsage tab-completes UsageIDs',
                'List available usages with: (Get-UsageRegistry).PSObject.Properties.Name | Where-Object { $_ -notmatch ''^_'' }',
                "Add a new entry to ai-usages.json for '$UsageId'"
            ))
    }

    # Walk _extends chain. Guard against cycles with a bounded depth + visited set.
    $chain = [System.Collections.Generic.List[string]]::new()
    $visited = [System.Collections.Generic.HashSet[string]]::new()
    $cursor = $UsageId
    $max = 8
    while ($cursor -and $chain.Count -lt $max) {
        if (-not $visited.Add($cursor)) {
            throw (New-ActionableError -PassThru `
                -Goal 'Resolve usage config' `
                -Problem "_extends cycle detected: $($chain -join ' → ') → $cursor" `
                -Location 'Get-UsageConfig' `
                -NextSteps @("Break the cycle in ai-usages.json — remove _extends from one of the entries"))
        }
        $chain.Add($cursor)
        $node = $Registry.$cursor
        if ($node.PSObject.Properties['_extends']) {
            $cursor = [string]$node._extends
        } else {
            $cursor = $null
        }
    }
    if ($chain.Count -ge $max) {
        throw (New-ActionableError -PassThru `
            -Goal 'Resolve usage config' `
            -Problem "_extends chain exceeded max depth ($max)" `
            -Location 'Get-UsageConfig' `
            -NextSteps @('Flatten the extends chain in ai-usages.json'))
    }

    # Merge parent → child. Iterate from the deepest ancestor down so children override.
    $merged = @{}
    for ($i = $chain.Count - 1; $i -ge 0; $i--) {
        $entry = $Registry.($chain[$i])
        foreach ($prop in $entry.PSObject.Properties) {
            if ($prop.Name -eq '_extends') { continue }
            $merged[$prop.Name] = $prop.Value
        }
    }
    return $merged
}

function Convert-UsageTemplate {
    <#
    .SYNOPSIS
        Renders a template string by substituting {{key}} placeholders from a values hashtable.
    .DESCRIPTION
        Missing placeholders throw an ActionableError so silent no-op substitution
        can't hide bugs. Empty template returns empty string. Non-string values
        are coerced via [string].
    .PARAMETER Template
        The template string with {{var}} placeholders.
    .PARAMETER Values
        Hashtable mapping placeholder names to values.
    .PARAMETER UsageIdContext
        Optional UsageID for improved error context.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Template,

        [Parameter(Mandatory)]
        [hashtable]$Values,

        [string]$UsageIdContext = ''
    )
    Set-StrictMode -Version Latest

    if ([string]::IsNullOrEmpty($Template)) { return '' }

    $placeholders = [regex]::Matches($Template, '\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}')
    $missing = [System.Collections.Generic.List[string]]::new()
    foreach ($m in $placeholders) {
        $name = $m.Groups[1].Value
        if (-not $Values.ContainsKey($name)) {
            if (-not $missing.Contains($name)) { $missing.Add($name) }
        }
    }
    if ($missing.Count -gt 0) {
        $ctx = if ($UsageIdContext) { " for UsageID '$UsageIdContext'" } else { '' }
        throw (New-ActionableError -PassThru `
            -Goal 'Render usage template' `
            -Problem "Missing template value(s)${ctx}: $($missing -join ', ')" `
            -Location 'Convert-UsageTemplate' `
            -NextSteps @(
                'Add the missing keys to the -Values hashtable passed to Invoke-AIByUsage',
                'Or update ai-usages.json to remove the unused placeholder(s)'
            ))
    }

    return [regex]::Replace($Template, '\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}', {
        param($m)
        $name = $m.Groups[1].Value
        return [string]$Values[$name]
    })
}
