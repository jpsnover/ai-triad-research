# Tag: debate (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Synthesize a debate fixture with calibration_log so the rating is computable
    $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "measure-debate-quality-$(Get-Random)"
    $null = New-Item -ItemType Directory -Path $script:TempDir -Force

    $script:FixtureHigh = Join-Path $script:TempDir 'debate-high.json'
    $script:FixtureLow  = Join-Path $script:TempDir 'debate-low.json'
    $script:FixtureNoCalibration = Join-Path $script:TempDir 'debate-nocal.json'

    @{
        title              = 'High quality debate'
        debate_model       = 'claude-opus-4'
        debate_temperature = 0.3
        protocol_id        = 'structured'
        app_version        = 'test'
        created_at         = '2026-06-29T00:00:00Z'
        transcript         = @(@{ x = 1 }, @{ x = 2 }, @{ x = 3 })
        calibration_log    = @{
            crux_addressed_ratio     = 0.9
            repetition_rate          = 0.05
            claims_forgotten_rate    = 0.05
            taxonomy_mapped_ratio    = 0.9
            situation_crux_alignment = 0.9
            avg_branch_cohesion      = 0.8
            topic_alignment_rate     = 0.9
            draft_repair_rate        = 0.05
            avg_utilization_rate     = 0.8
            concession_cascades      = 0
        }
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $script:FixtureHigh -Encoding utf8NoBOM

    @{
        title              = 'Low quality debate'
        debate_model       = 'gemini-3.5-flash-lite'
        debate_temperature = 0.7
        protocol_id        = 'deliberation'
        app_version        = 'test'
        created_at         = '2026-06-29T00:00:00Z'
        transcript         = @(@{ x = 1 })
        calibration_log    = @{
            crux_addressed_ratio     = 0.1
            repetition_rate          = 0.8
            claims_forgotten_rate    = 0.7
            taxonomy_mapped_ratio    = 0.2
            situation_crux_alignment = 0.1
            avg_branch_cohesion      = 0.1
            topic_alignment_rate     = 0.2
            draft_repair_rate        = 0.6
            avg_utilization_rate     = 0.1
            concession_cascades      = 0
        }
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $script:FixtureLow -Encoding utf8NoBOM

    @{
        title              = 'Old debate without calibration log'
        debate_model       = 'gemini-2.5-flash'
        debate_temperature = 0.5
        protocol_id        = 'structured'
        app_version        = 'test'
        created_at         = '2026-06-29T00:00:00Z'
        transcript         = @(@{ x = 1 })
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $script:FixtureNoCalibration -Encoding utf8NoBOM
}

AfterAll {
    if ($script:TempDir -and (Test-Path $script:TempDir)) {
        Remove-Item $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Describe 'Measure-DebateQuality' -Tag 'debate' {

    It 'Is exported from the module' {
        Get-Command Measure-DebateQuality -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has three parameter sets: ByPath, ById, Latest' {
        $cmd = Get-Command Measure-DebateQuality -Module AITriad
        $setNames = @($cmd.ParameterSets | ForEach-Object { $_.Name })
        $setNames | Should -Contain 'ByPath'
        $setNames | Should -Contain 'ById'
        $setNames | Should -Contain 'Latest'
    }

    It 'Returns an object with expected properties for a high-quality debate' {
        $result = Measure-DebateQuality -Path $script:FixtureHigh
        $result.OverallRating | Should -BeGreaterThan 75
        $result.Tier | Should -Be 'Excellent'
        $result.Topic | Should -Be 'High quality debate'
        $result.Model | Should -Be 'claude-opus-4'
        $result.Dimensions.ArgumentDepth | Should -Be 0.9
        $result.Dimensions.ClaimCoverage | Should -Be 0.9
    }

    It 'Returns a low Tier for a poor-quality debate' {
        $result = Measure-DebateQuality -Path $script:FixtureLow
        $result.OverallRating | Should -BeLessThan 40
        $result.Tier | Should -Be 'Poor'
    }

    It 'Returns null OverallRating and warning when calibration_log is missing' {
        $warnings = $null
        $result = Measure-DebateQuality -Path $script:FixtureNoCalibration -WarningVariable warnings -WarningAction SilentlyContinue
        $result.OverallRating | Should -BeNullOrEmpty
        $result.Tier | Should -Be 'Unrated'
        $warnings | Should -Not -BeNullOrEmpty
        $warnings[0].ToString() | Should -Match 'no calibration_log'
    }

    It 'Includes raw Metrics when -PassThruMetrics is specified' {
        $result = Measure-DebateQuality -Path $script:FixtureHigh -PassThruMetrics
        $result.PSObject.Properties['Metrics'] | Should -Not -BeNullOrEmpty
        $result.Metrics.calibration.crux_addressed_ratio | Should -Be 0.9
    }

    It 'Omits Metrics property by default' {
        $result = Measure-DebateQuality -Path $script:FixtureHigh
        $result.PSObject.Properties['Metrics'] | Should -BeNullOrEmpty
    }

    It 'Accepts pipeline input by property name' {
        $result = [PSCustomObject]@{ Path = $script:FixtureHigh } | Measure-DebateQuality
        $result.Topic | Should -Be 'High quality debate'
    }

    It 'OverallRating is clamped to [0, 100]' {
        $result = Measure-DebateQuality -Path $script:FixtureHigh
        $result.OverallRating | Should -BeGreaterOrEqual 0
        $result.OverallRating | Should -BeLessOrEqual 100
    }

    It 'Dimensions surface includes all 8 expected keys' {
        $result = Measure-DebateQuality -Path $script:FixtureHigh
        $expected = @('ArgumentDepth','ClaimCoverage','RebuttalEffectiveness','POVBalance','RhetoricalQuality','TopicAlignment','RepetitionResistance','ClaimRetention')
        foreach ($k in $expected) {
            $result.Dimensions.PSObject.Properties[$k] | Should -Not -BeNullOrEmpty
        }
    }

    # ── t/1346: pin OverallRating to a 1-dp double so the [Math]::Min(int,double)
    # int-coercion regression cannot re-slip past the existing "-BeGreaterThan/-BeLessThan" checks. ──
    It 'OverallRating is Double with 1-dp precision (t/1346 regression guard: FixtureHigh -> 90.2)' {
        # Raw arithmetic on FixtureHigh (all metrics 0.9/0.8/0.05):
        #   0.9*20 + 0.9*15 + 0.9*15 + 0.8*10 + 0.9*15 + 0.95*10 + 0.95*10 + 0.95*5 = 90.25
        # [Math]::Round(90.25, 1) with banker's rounding -> 90.2 (Double).
        # Before the t/1346 fix, this returned exactly 90 (Decimal) because
        # [Math]::Min(100, $Score) resolved to Min(int,int), coercing $Score to Int32.
        $result = Measure-DebateQuality -Path $script:FixtureHigh
        $result.OverallRating              | Should -Be 90.2
        $result.OverallRating.GetType().Name | Should -Be 'Double'
    }

    It 'OverallRating is Double with 1-dp precision (t/1346 regression guard: FixtureLow -> 17.5)' {
        $result = Measure-DebateQuality -Path $script:FixtureLow
        $result.OverallRating              | Should -Be 17.5
        $result.OverallRating.GetType().Name | Should -Be 'Double'
    }
}

Describe 'Measure-DebateQuality - manifest' -Tag 'debate' {
    It 'FunctionsToExport includes Measure-DebateQuality' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Measure-DebateQuality'
    }
}
