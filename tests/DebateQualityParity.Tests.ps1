# Tag: debate (t/1344)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Cross-runtime parity guard for the debate quality-score formula.
.DESCRIPTION
    lib/debate/qualityScore.ts (used by the CI node runner) and
    Measure-DebateQuality (used from PowerShell) both apply the same
    8-metric weighted formula. Unsynchronized copies WILL drift; this
    suite scores one fixture with both implementations and asserts
    parity (score ±0.5, tier exact).

    Expected fixture arithmetic (weights sum to 100):
      0.72*20 + 0.65*15 + 0.58*15 + 0.61*10 + 0.83*15
        + 0.78*10 + 0.82*10 + 0.69*5
      = 70.85 -> round(1dp) -> 70.9 -> tier Good.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..')
    $script:Fixture    = Join-Path $PSScriptRoot 'fixtures' 'quality-parity' 'debate-fixture.json'
    $script:ScoreShim  = Join-Path $PSScriptRoot 'fixtures' 'quality-parity' 'score.mjs'

    # Resolve tsx directly from node_modules/.bin — bypasses the npx.ps1 shim
    # entirely (that shim inherits Pester's strict mode and errors on our
    # $script:* references before reaching node). tsx is a repo-root
    # devDependency; requires `npm ci` in the repo root before running.
    $tsxBin = Join-Path $script:RepoRoot 'node_modules' '.bin' 'tsx'
    $script:TsxCmd = if ($IsWindows) { "$tsxBin.cmd" } else { $tsxBin }
    $script:NodeMissing = -not (Get-Command node -ErrorAction SilentlyContinue) `
                       -or -not (Test-Path $script:TsxCmd)

    # Score once via PS so both `It` blocks see the same number.
    if (Test-Path $script:Fixture) {
        $script:PsResult = Measure-DebateQuality -Path $script:Fixture
    }

    # Score once via tsx (unless tsx.cmd absent, in which case tests self-skip
    # with an ALARMING reason so a CI runner regression can't quietly pass-by-skip).
    $script:TsResult   = $null
    $script:TsStderr   = ''
    $script:TsExitCode = $null
    if (-not $script:NodeMissing -and (Test-Path $script:ScoreShim)) {
        $stderrPath = [System.IO.Path]::GetTempFileName()
        try {
            Push-Location $script:RepoRoot
            try {
                $stdout = & $script:TsxCmd $script:ScoreShim $script:Fixture 2>$stderrPath
                $script:TsExitCode = $LASTEXITCODE
            } finally {
                Pop-Location
            }
            $script:TsStderr = Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            if ($script:TsExitCode -eq 0 -and $stdout) {
                # Assert on parsed values, never on raw text (t/1287 CRLF lesson).
                $joined = ($stdout -join "`n").Trim() -replace "`r`n", "`n"
                $script:TsResult = $joined | ConvertFrom-Json
            }
        } finally {
            Remove-Item -LiteralPath $stderrPath -ErrorAction SilentlyContinue
        }
    }
}

Describe 'Debate quality-score cross-runtime parity (t/1344)' -Tag 'debate' {

    It 'PS Measure-DebateQuality scores the fixture to 70.8 / tier Good' {
        if ($script:NodeMissing) {
            Set-ItResult -Skipped -Because 'node/tsx missing on PATH — PARITY GUARD NOT RUN (CI regression?)'
            return
        }
        # Fixture raw arithmetic = 70.85. Post-t/1346 fix, [Math]::Round uses .NET's
        # banker's rounding (MidpointRounding.ToEven), so 70.85 -> 70.8 (Double).
        # Pre-t/1346, this returned 71 (Decimal) because [Math]::Min(100, $Score)
        # picked the (int,int) overload and coerced $Score to Int32.
        $script:PsResult                     | Should -Not -BeNullOrEmpty
        $script:PsResult.OverallRating       | Should -Be 70.8
        $script:PsResult.OverallRating.GetType().Name | Should -Be 'Double'
        $script:PsResult.Tier                | Should -Be 'Good'
    }

    It 'TS computeQualityScore (via npx tsx) scores the same fixture' {
        if ($script:NodeMissing) {
            Set-ItResult -Skipped -Because 'node/tsx missing on PATH — PARITY GUARD NOT RUN (CI regression?)'
            return
        }
        if (-not $script:TsResult) {
            throw "npx tsx did not return parseable JSON. stderr:`n$($script:TsStderr)"
        }
        $script:TsResult.PSObject.Properties['score'] | Should -Not -BeNullOrEmpty
        $script:TsResult.PSObject.Properties['tier']  | Should -Not -BeNullOrEmpty
        $script:TsResult.score | Should -BeOfType [double]
        $script:TsResult.tier  | Should -Be 'Good'
    }

    It 'PS and TS scores agree (fork-drift guard: |diff| < 0.5, tier exact)' {
        if ($script:NodeMissing) {
            Set-ItResult -Skipped -Because 'node/tsx missing on PATH — PARITY GUARD NOT RUN (CI regression?)'
            return
        }
        if (-not $script:TsResult) {
            throw "TS scorer produced no result — cannot compare. stderr:`n$($script:TsStderr)"
        }
        # NOTE on why the diff will always be ~0.1 and not 0 for midpoint scores:
        # JS Math.round is halves-away-from-zero (70.85 -> 70.9). .NET [Math]::Round
        # defaults to MidpointRounding.ToEven / banker's (70.85 -> 70.8). Both are
        # legitimate; unifying them is a follow-up if the tolerance ever needs to
        # shrink. Today's ±0.5 tolerance is loose enough to absorb this + any
        # numeric-precision jitter, while still catching a weight change.
        $diff = [Math]::Abs([double]$script:PsResult.OverallRating - [double]$script:TsResult.score)
        $diff | Should -BeLessThan 0.5 -Because "PS=$($script:PsResult.OverallRating) TS=$($script:TsResult.score) — formula fork detected between qualityScore.ts and Measure-DebateQuality"
        $script:PsResult.Tier | Should -Be $script:TsResult.tier
    }
}
