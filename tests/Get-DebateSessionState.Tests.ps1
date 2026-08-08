# Tag: debate (t/2330)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# ── Discovery-time: compute skip predicate ─────────────────────────────────
# Pester 5 evaluates -Skip during Discovery (before BeforeAll).  Resolve data
# availability here at script scope so the predicate is ready in time.
# git worktree list points us at the main checkout regardless of whether we
# are running from the shared tree or a linked worktree.
$_wt = & git worktree list --porcelain 2>$null
$_mainRoot = ($_wt | Where-Object { $_ -match '^worktree ' } | Select-Object -First 1) -replace '^worktree ',''
$_cfg      = if ($_mainRoot) { Join-Path $_mainRoot '.aitriad.json' } else { $null }
$script:DEBATES_AVAILABLE = if (-not [string]::IsNullOrWhiteSpace($env:AI_TRIAD_DATA_ROOT)) {
    Test-Path (Join-Path $env:AI_TRIAD_DATA_ROOT 'debates')
} elseif ($_cfg -and (Test-Path $_cfg)) {
    $_cfgData = Get-Content $_cfg -Raw | ConvertFrom-Json
    $_dr = [System.IO.Path]::GetFullPath((Join-Path (Split-Path $_cfg -Parent) $_cfgData.data_root))
    Test-Path (Join-Path $_dr 'debates')
} else { $false }

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Load a real sample debate ID for the happy-path tests via module-scope call
    $DebatesDir = & (Get-Module AITriad) { Get-DebatesDir }
    $SampleFile = if ($DebatesDir -and (Test-Path $DebatesDir)) {
        Get-ChildItem $DebatesDir -Filter 'debate-*.json' -File -ErrorAction SilentlyContinue |
            Select-Object -First 1
    } else { $null }
    $script:SampleId   = if ($SampleFile) { $SampleFile.BaseName -replace '^debate-', '' } else { $null }
    $script:SamplePath = if ($SampleFile) { $SampleFile.FullName } else { $null }
}

Describe 'Get-DebateSessionState' -Tag 'debate' {

    It 'Returns a result for a valid debate ID' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId $script:SampleId
        $result | Should -Not -BeNullOrEmpty
    }

    It 'Result has all required output fields' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId $script:SampleId
        $result.PSObject.Properties.Name | Should -Contain 'DebateId'
        $result.PSObject.Properties.Name | Should -Contain 'Phase'
        $result.PSObject.Properties.Name | Should -Contain 'TranscriptLength'
        $result.PSObject.Properties.Name | Should -Contain 'RunId'
        $result.PSObject.Properties.Name | Should -Contain 'UpdatedAt'
        $result.PSObject.Properties.Name | Should -Contain 'PayloadBytes'
        $result.PSObject.Properties.Name | Should -Contain 'FilePath'
    }

    It 'DebateId in output matches input (without debate- prefix)' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId $script:SampleId
        $result.DebateId | Should -Be $script:SampleId
    }

    It 'Accepts debate- prefix and strips it' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId "debate-$($script:SampleId)"
        $result.DebateId | Should -Be $script:SampleId
    }

    It 'FilePath points to a real file' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId $script:SampleId
        Test-Path $result.FilePath | Should -Be $true
    }

    It 'PayloadBytes is positive' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId $script:SampleId
        $result.PayloadBytes | Should -BeGreaterThan 0
    }

    It 'TranscriptLength is a non-negative integer' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = Get-DebateSessionState -DebateId $script:SampleId
        $result.TranscriptLength | Should -BeGreaterOrEqual 0
    }

    It 'Throws ActionableError for unknown debate ID' {
        { Get-DebateSessionState -DebateId '00000000-0000-0000-0000-000000000000' } |
            Should -Throw
    }

    It 'Accepts pipeline input' -Skip:(-not $script:DEBATES_AVAILABLE) {
        $result = $script:SampleId | Get-DebateSessionState
        $result.DebateId | Should -Be $script:SampleId
    }
}
