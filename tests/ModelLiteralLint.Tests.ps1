# Tag: config (t/1858)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Lint: every -Model literal in tests/ must name a model registered in ai-models.json.

.DESCRIPTION
    Guards against test-fixture staleness (t/1850 -> t/1858): a test that mocks a
    de-registered model id (e.g. after a migration drops it from ai-models.json)
    passes locally but represents a latent P0 — Invoke-AIApi returns $null before the
    parser runs, so the fixture no longer exercises what it claims to. Test-AIModelsConfig
    validates the config, not the test files, so it structurally cannot catch this.

    This lint scans every tests/**/*.ps1 for a -Model parameter bound to a string literal
    and resolves that id against the module's registered set ($script:ValidModelIds, the
    same authority Test-AIModelId uses). Any unregistered id fails the test.

    Suppression: a deliberately-invalid id (negative tests, mock-only backends) is exempted
    by an inline trailing marker comment "# model-lint:allow" on the same physical line as
    the literal. The marker is co-located with the literal per gate-integrity (Sage #20/#46).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Registered set — the same list Test-AIModelId validates against (models[].id).
    $script:ValidIds = @(InModuleScope AITriad { $script:ValidModelIds })

    # Match a -Model parameter bound to a single- or double-quoted literal.
    # Group 2 captures the id. Requires the leading dash, so it never matches a
    # `Model = '...'` property assignment on a mock return object.
    $script:ModelLiteralPattern = '-Model(?::|\s+)([''"])([^''"]+)\1'
    $script:SuppressMarker      = '# model-lint:allow'

    # Collect every (file, line, id) up front so individual It blocks stay declarative.
    $script:ModelLiterals = [System.Collections.Generic.List[object]]::new()
    foreach ($file in Get-ChildItem -Path $PSScriptRoot -Filter '*.ps1' -File -Recurse) {
        $lineNo = 0
        foreach ($line in [System.IO.File]::ReadAllLines($file.FullName)) {
            $lineNo++
            if ($line.Contains($script:SuppressMarker)) { continue }
            foreach ($match in [regex]::Matches($line, $script:ModelLiteralPattern)) {
                $script:ModelLiterals.Add([PSCustomObject]@{
                    File = $file.Name
                    Line = $lineNo
                    Id   = $match.Groups[2].Value
                })
            }
        }
    }
}

Describe 'Test-file -Model literals resolve to registered models' -Tag 'config' {

    It 'ai-models.json exposes a non-empty registered model set' {
        # False-green guard: if the module fails to load ids, this fails loudly here
        # rather than silently letting the resolution below pass on an empty set.
        @($script:ValidIds).Count | Should -BeGreaterThan 0
    }

    It 'the scan detects -Model literals (guards against a vacuous lint)' {
        # If the parser regex ever breaks, it finds nothing and the resolution below
        # passes vacuously. This asserts the scan is actually seeing literals.
        @($script:ModelLiterals).Count | Should -BeGreaterThan 0
    }

    It 'every -Model literal in tests/ names a model registered in ai-models.json' {
        $offenders = @($script:ModelLiterals | Where-Object { $_.Id -notin $script:ValidIds })
        $report = ($offenders | ForEach-Object { "$($_.File):$($_.Line) names unregistered id '$($_.Id)'" }) -join "`n"
        $offenders.Count | Should -Be 0 -Because "test fixtures must mock only registered models. Fix each: register the id in ai-models.json, repoint to a valid id, or (if the id is intentionally invalid) append a model-lint:allow marker comment on that line.`n$report"
    }
}
