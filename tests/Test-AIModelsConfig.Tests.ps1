# Tag: config (t/1705)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Test-AIModelsConfig (t/1705).
.DESCRIPTION
    Validates the ai-models.json config-defect checks that two 2026-07-24 flight
    recorder incidents would have caught: BOM (t/1702), orphaned model references
    (t/1703), incomplete models[] entries, and friendly-id-in-apiModelId.

    Severity model (matches lib/ai-client/registry.ts validateModelConfig):
    BOM / invalid JSON / incomplete entry / friendly-id-in-apiModelId are Errors
    (fail Pass); unresolved references are Warnings (surfaced but Pass-tolerant,
    because verbatim provider passthrough is intentional and can't be
    auto-distinguished from a typo).

    The "committed config has no Errors" test is BOTH the AC#1 gate AND the CI
    invocation (test-powershell runs all of ./tests/), and doubles as the drift
    tripwire for the ported getApiModelId/-latest resolver + the prefix-exempt
    backend set.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    $script:RealConfig = Join-Path $PSScriptRoot '..' 'ai-models.json'

    function New-BrokenConfig {
        param([string]$Dir, [string]$Name, [switch]$WithBom)
        $json = @'
{
  "models": [
    { "id": "gemini-3.5-flash", "apiModelId": "gemini-3.5-flash", "backend": "gemini" },
    { "id": "gemini-2.5-flash", "apiModelId": "gemini-2.5-flash", "backend": "gemini" },
    { "id": "zai-glm-5-2",      "apiModelId": "zai-glm-5-2",      "backend": "zai" },
    { "id": "broken-model",     "apiModelId": "x",                "backend": "" }
  ],
  "defaults": { "gemini": "gemini-3.5-flash", "zai": "zai-missing-ref" },
  "debateTiers": { "_comment": "skip me", "basic": { "gemini": "gemini-3.5-flash" } },
  "fallbackChains": { "gemini-3.5-flash": ["gemini-2.5-flash", "also-missing"] }
}
'@
        $path = Join-Path $Dir $Name
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        if ($WithBom) { $bytes = ([byte[]](0xEF, 0xBB, 0xBF)) + $bytes }
        [System.IO.File]::WriteAllBytes($path, $bytes)
        return $path
    }
}

Describe 'Test-AIModelsConfig' -Tag 'config' {

    It 'has no Error-severity issues on the committed ai-models.json (AC#1; the CI invocation + resolver/exempt-set drift tripwire)' {
        $result = Test-AIModelsConfig -Path $script:RealConfig -WarningAction SilentlyContinue
        $errs = @($result.Issues | Where-Object { $_.Severity -eq 'Error' })
        $detail = ($errs | ForEach-Object { "$($_.Check) @ $($_.Site)" }) -join '; '
        $result.Pass | Should -BeTrue -Because "the committed config must be error-free; errors found: $detail"
        @($errs).Count | Should -Be 0
    }

    It 'reports BOM, unresolved refs, friendly-id-in-apiModelId, and incomplete entries on a broken config (AC#2)' {
        $broken = New-BrokenConfig -Dir $TestDrive -Name 'broken-bom.json' -WithBom
        $result = Test-AIModelsConfig -Path $broken -WarningAction SilentlyContinue

        $result.Pass | Should -BeFalse -Because 'Error-severity defects (BOM, incomplete entry, friendly-id apiModelId) must fail Pass'
        $checks = @($result.Issues.Check)
        $checks | Should -Contain 'BOM'                 -Because 'the UTF-8 BOM that breaks Electron JSON.parse (t/1702)'
        $checks | Should -Contain 'ApiModelIdPrefix'    -Because 'zai apiModelId "zai-glm-5-2" is the friendly id, not the API model name (t/1703 class)'
        $checks | Should -Contain 'IncompleteModel'     -Because 'the broken-model entry has an empty backend'
        $checks | Should -Contain 'UnresolvedReference' -Because 'defaults.zai and a fallbackChains entry reference ids with no models[] match'

        # Error vs Warning severities are assigned as designed.
        @($result.Issues | Where-Object { $_.Check -eq 'BOM' })[0].Severity                 | Should -Be 'Error'
        @($result.Issues | Where-Object { $_.Check -eq 'ApiModelIdPrefix' })[0].Severity    | Should -Be 'Error'
        @($result.Issues | Where-Object { $_.Check -eq 'UnresolvedReference' })[0].Severity | Should -Be 'Warning'

        # The specific orphaned references are named; legitimate ids are NOT flagged.
        $unresolved = @($result.Issues | Where-Object { $_.Check -eq 'UnresolvedReference' } | ForEach-Object { $_.Detail })
        ($unresolved -join ' ') | Should -Match 'zai-missing-ref'
        ($unresolved -join ' ') | Should -Match 'also-missing'
        ($result.Issues | Where-Object { $_.Detail -match "'gemini-3\.5-flash'" }) | Should -BeNullOrEmpty -Because 'gemini-3.5-flash is a real models[] id and must resolve'
    }

    It 'does not fire the BOM check when the file has no BOM (no false positives)' {
        $clean = New-BrokenConfig -Dir $TestDrive -Name 'broken-nobom.json'   # same defects, no BOM
        $result = Test-AIModelsConfig -Path $clean -WarningAction SilentlyContinue
        @($result.Issues | Where-Object { $_.Check -eq 'BOM' }).Count | Should -Be 0 -Because 'no BOM was written, so the BOM check must not fire'
    }

    It 'resolves a <family>-latest alias to a versioned family member (getApiModelId parity)' {
        $json = @'
{
  "models": [
    { "id": "gemini-3.5-flash", "apiModelId": "gemini-3.5-flash", "backend": "gemini" },
    { "id": "gemini-2.5-flash", "apiModelId": "gemini-2.5-flash", "backend": "gemini" }
  ],
  "defaults": { "gemini": "gemini-flash-latest" }
}
'@
        $path = Join-Path $TestDrive 'latest-alias.json'
        [System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($json))
        $result = Test-AIModelsConfig -Path $path -WarningAction SilentlyContinue

        @($result.Issues | Where-Object { $_.Check -eq 'UnresolvedReference' }).Count |
            Should -Be 0 -Because '"gemini-flash-latest" must resolve to the highest-version gemini-*-flash member (mirrors registry.ts buildModelIdMap)'
    }
}
