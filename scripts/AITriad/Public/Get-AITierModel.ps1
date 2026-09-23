# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITierModel {
    <#
    .SYNOPSIS
        Resolve a model-tier + backend to the currently-registered model id, from
        the single ai-models.json authority (drift-proof — t/3564).
    .DESCRIPTION
        Cmdlet defaults across the module hardcode a model id literal
        (e.g. `[string]$Model = 'gemini-3.5-flash-lite'`). When the registry's
        preferred cheap-fast model changes, every literal must be hand-updated and a
        missed one silently drifts to a de-registered id (t/3560 class). This helper
        resolves a tier ('basic' = fast/cheap, 'advanced' = frontier) for a backend to
        the id currently pinned in ai-models.json `debateTiers`, so call sites reference
        the tier rather than a literal and there is exactly one place to update.

        Reads the in-memory `$script:AIModelConfig` loaded at module import — no file
        re-parse, no dependency on AIEnrich. Returns a registered model id string.

        Note: this resolves the debate-tier map only. The per-backend default
        (`defaults.<backend>` in ai-models.json) is intentionally NOT exposed here —
        that name space is reserved for a future `Get-AIDefaultModel` (t/3564, TL).
    .PARAMETER Tier
        'basic' (fast/cheap) or 'advanced' (frontier). Default 'basic'.
    .PARAMETER Backend
        Backend id (gemini, claude, groq, openai, azure, deepseek, ollama, zai).
        Default 'gemini' — the module's universal default backend. If a tier has no
        entry for the requested backend, resolution falls back to that tier's gemini
        entry with a WARN (Fallback-Path Logging).
    .OUTPUTS
        [string] — a model id registered in ai-models.json.
    .EXAMPLE
        Get-AITierModel -Tier basic
        # -> 'gemini-3.5-flash-lite' (the registered fast/cheap gemini model)
    .EXAMPLE
        Get-AITierModel -Tier advanced -Backend claude
        # -> the registered frontier claude model
    .EXAMPLE
        [string]$Model = (Get-AITierModel -Tier basic)   # drift-proof cmdlet default
    .LINK
        Test-AIModelId
    .LINK
        Show-AITriadHelp
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Position = 0)]
        [ValidateSet('basic', 'advanced')]
        [string]$Tier = 'basic',

        [Parameter(Position = 1)]
        [ArgumentCompleter({
            param($cmd, $param, $wordToComplete)
            $cfg = $script:AIModelConfig
            if ($cfg -and $cfg.PSObject.Properties['debateTiers'] -and $cfg.debateTiers.PSObject.Properties['basic']) {
                $cfg.debateTiers.basic.PSObject.Properties.Name |
                    Where-Object { $_ -like "$wordToComplete*" } | Sort-Object
            }
        })]
        [ValidateNotNullOrEmpty()]
        [string]$Backend = 'gemini'
    )

    Set-StrictMode -Version Latest

    $cfg = $script:AIModelConfig

    # Hard fail — registry unavailable / no debateTiers. The whole module is degraded
    # in this state (no valid model set), so surface it explicitly rather than return
    # a stale literal that would reintroduce the drift this helper exists to remove.
    if (-not $cfg -or -not $cfg.PSObject.Properties['debateTiers'] -or -not $cfg.debateTiers) {
        throw (New-ActionableError -PassThru `
            -Goal "Resolve the '$Tier' tier model for backend '$Backend'" `
            -Problem "ai-models.json is not loaded, or has no 'debateTiers' section — the model registry is unavailable" `
            -Location 'Get-AITierModel' `
            -NextSteps @(
                'Confirm ai-models.json exists at the repo root and is valid JSON',
                'Re-import the module: Import-Module ./scripts/AITriad/AITriad.psm1 -Force'
            ))
    }

    if (-not $cfg.debateTiers.PSObject.Properties[$Tier] -or -not $cfg.debateTiers.$Tier) {
        throw (New-ActionableError -PassThru `
            -Goal "Resolve the '$Tier' tier model for backend '$Backend'" `
            -Problem "ai-models.json 'debateTiers' has no '$Tier' entry" `
            -Location 'Get-AITierModel' `
            -NextSteps @("Add a '$Tier' block under debateTiers in ai-models.json"))
    }
    $tierObj = $cfg.debateTiers.$Tier

    # Primary path — the requested backend is pinned for this tier.
    if ($tierObj.PSObject.Properties[$Backend] -and $tierObj.$Backend) {
        return [string]$tierObj.$Backend
    }

    # Fallback path — backend absent for this tier: fall back to gemini (the module's
    # universal default backend). Logged per Fallback-Path Logging (docs/error-handling.md).
    if ($Backend -ne 'gemini' -and $tierObj.PSObject.Properties['gemini'] -and $tierObj.gemini) {
        Write-Warning "Get-AITierModel: tier '$Tier' has no entry for backend '$Backend'; falling back to gemini ('$($tierObj.gemini)'). Add '$Backend' under debateTiers.$Tier in ai-models.json to pin it explicitly."
        return [string]$tierObj.gemini
    }

    # Hard fail — neither the requested backend nor a gemini fallback exists in this tier.
    throw (New-ActionableError -PassThru `
        -Goal "Resolve the '$Tier' tier model for backend '$Backend'" `
        -Problem "debateTiers.$Tier has no entry for '$Backend' and no 'gemini' fallback" `
        -Location 'Get-AITierModel' `
        -NextSteps @("Add a '$Backend' (or 'gemini') entry under debateTiers.$Tier in ai-models.json"))
}
