# Tag: cost (t/3951)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Cross-runtime parity guard for pricing-key resolution (t/3946#5 item 4,
    SO e/248, mandatory condition of t/3951's binding design).
.DESCRIPTION
    For every model in the real ai-models.json, PS resolution via (backend,
    apiModelId) -> models[].id -> pricing[id] (Get-AICostPricing's
    ApiModelIdMap) must agree with lib/ai-client/pricing-resolve-cli.ts's
    TS resolution by models[].id (resolvePricingKey). Unsynchronized copies
    of this resolution logic WILL drift (that's exactly how the original
    t/3946 bug happened).

    lib/ai-client/pricing-resolve-cli.ts lands via PR #2826 (t/3946,
    Shared Lib) -- not yet on main as of this writing. Skips with an
    ALARMING reason (never a silent pass) if the CLI file is absent, same
    discipline as DebateQualityParity.Tests.ps1 for missing tsx.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue

    $script:RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
    $script:CliPath  = Join-Path $script:RepoRoot 'lib' 'ai-client' 'pricing-resolve-cli.ts'

    # node_modules isn't duplicated per git worktree; fall back to the main
    # checkout's install if this worktree doesn't have its own.
    $tsxBin = Join-Path $script:RepoRoot 'node_modules' '.bin' 'tsx'
    if (-not (Test-Path $tsxBin) -and -not (Test-Path "$tsxBin.cmd")) {
        $MainRepoRoot = git -C $script:RepoRoot rev-parse --git-common-dir 2>$null
        if ($MainRepoRoot) {
            $MainRepoRoot = Split-Path -Parent (Resolve-Path $MainRepoRoot)
            $tsxBin = Join-Path $MainRepoRoot 'node_modules' '.bin' 'tsx'
        }
    }
    $script:TsxCmd = if ($IsWindows) { "$tsxBin.cmd" } else { $tsxBin }
    $script:CliMissing = -not (Get-Command node -ErrorAction SilentlyContinue) `
                       -or -not (Test-Path $script:TsxCmd) `
                       -or -not (Test-Path $script:CliPath)

    $script:TsRows   = $null
    $script:TsStderr = ''
    if (-not $script:CliMissing) {
        $stderrPath = [System.IO.Path]::GetTempFileName()
        try {
            Push-Location $script:RepoRoot
            try {
                $stdout = & $script:TsxCmd $script:CliPath 2>$stderrPath
                $ExitCode = $LASTEXITCODE
            } finally {
                Pop-Location
            }
            $script:TsStderr = Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            if ($ExitCode -eq 0 -and $stdout) {
                $joined = ($stdout -join "`n").Trim() -replace "`r`n", "`n"
                $script:TsRows = $joined | ConvertFrom-Json
            }
        } finally {
            Remove-Item -LiteralPath $stderrPath -ErrorAction SilentlyContinue
        }
    }

    $script:PsInfo = InModuleScope AITriad { Get-AICostPricing }
}

Describe 'PS/TS pricing-key resolution parity (t/3951, SO e/248 condition 5)' -Tag 'cost' {

    It 'TS pricing-resolve-cli ran and returned parseable rows' {
        if ($script:CliMissing) {
            Set-ItResult -Skipped -Because 'lib/ai-client/pricing-resolve-cli.ts (or node/tsx) is missing -- PARITY GUARD NOT RUN. Expected until PR #2826 (t/3946) merges to main; if this test suite runs after that and still skips, that IS a regression.'
            return
        }
        if ($null -eq $script:TsRows) {
            throw "tsx pricing-resolve-cli.ts did not return parseable JSON. stderr:`n$($script:TsStderr)"
        }
        @($script:TsRows).Count | Should -BeGreaterThan 0
    }

    It 'for every model, PS (backend, apiModelId) resolution agrees with TS resolution by id' {
        if ($script:CliMissing -or $null -eq $script:TsRows) {
            Set-ItResult -Skipped -Because 'lib/ai-client/pricing-resolve-cli.ts (or node/tsx) is missing -- PARITY GUARD NOT RUN.'
            return
        }

        $Mismatches = [System.Collections.Generic.List[string]]::new()
        foreach ($Row in @($script:TsRows)) {
            $MapKey = "$($Row.backend)|$($Row.apiModelId)"
            $PsResolvedId = if ($script:PsInfo.ApiModelIdMap.ContainsKey($MapKey)) { $script:PsInfo.ApiModelIdMap[$MapKey] } else { $null }
            $PsHasPricing = $PsResolvedId -and $script:PsInfo.Pricing.ContainsKey($PsResolvedId)
            $TsHasPricing = $null -ne $Row.pricingKey

            if ($PsHasPricing -ne $TsHasPricing) {
                $Mismatches.Add("$($Row.id) ($MapKey): PS hasPricing=$PsHasPricing (resolvedId=$PsResolvedId) vs TS pricingKey=$($Row.pricingKey)")
                continue
            }
            if ($PsHasPricing -and $PsResolvedId -ne $Row.pricingKey) {
                $Mismatches.Add("$($Row.id) ($MapKey): PS resolved '$PsResolvedId' but TS resolved '$($Row.pricingKey)'")
            }
        }

        @($Mismatches).Count | Should -Be 0 -Because "every PS/TS resolution mismatch:`n$($Mismatches -join "`n")"
    }

    It 'includes the 4 duplicated (apiModelId) pairs priced differently per backend (azure vs openai gpt-4o/gpt-4o-mini/gpt-4.1/gpt-4.1-mini)' {
        if ($script:CliMissing -or $null -eq $script:TsRows) {
            Set-ItResult -Skipped -Because 'lib/ai-client/pricing-resolve-cli.ts (or node/tsx) is missing -- PARITY GUARD NOT RUN.'
            return
        }
        foreach ($Api in 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini') {
            $Rows = @($script:TsRows | Where-Object { $_.apiModelId -eq $Api -and $_.backend -in @('azure', 'openai') })
            @($Rows).Count | Should -Be 2 -Because "$Api must be present for both azure and openai in the real registry"
        }
    }
}
