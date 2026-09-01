# Tag: unit (t/3179)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Fallback-Path Logging tests for AIEnrich.psm1 (t/3179) — both silent-fallback paths must
    emit Write-Warning with the triggering condition (docs/error-handling.md).
      Finding 6: Measure-PromptTokens — Gemini countTokens API failure -> character heuristic.
      Finding 7: module load — ai-models.json absent at all candidate paths -> hardcoded registry.
#>

BeforeAll {
    $script:ModulePath = (Resolve-Path (Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1')).Path
    Import-Module $script:ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'AIEnrich fallback-path logging (t/3179)' -Tag 'unit' {

    Context 'Finding 6 — Measure-PromptTokens countTokens failure -> heuristic' {
        It 'emits Write-Warning (not just Verbose) and falls back to the heuristic when countTokens fails' {
            Mock -ModuleName AIEnrich Resolve-AIApiKey { 'fake-gemini-key' }
            Mock -ModuleName AIEnrich Invoke-RestMethod { throw 'HTTP 503 countTokens unavailable' }

            $warn = @()
            $r = Measure-PromptTokens -Text 'some prompt text to measure' -WarningVariable warn -WarningAction SilentlyContinue

            # Fell back to the heuristic...
            $r.Accurate | Should -BeFalse
            $r.Method | Should -Match 'heuristic'
            # ...and surfaced the degraded path as a WARNING naming the trigger.
            ($warn -join ' ') | Should -Match 'countTokens failed'
        }
    }

    Context 'Finding 7 — ai-models.json absent at all candidate paths -> hardcoded registry' {
        It 'emits Write-Warning at module load when ai-models.json is not found' {
            # Isolate a copy of the module in a deeply-nested temp dir so NONE of its three
            # candidate paths (PSScriptRoot, its parent, its grandparent) contain ai-models.json,
            # forcing the file-not-found branch to fire on import.
            $iso = Join-Path $TestDrive ([guid]::NewGuid().ToString('N')) 'a' 'b'
            New-Item -ItemType Directory -Path $iso -Force | Out-Null
            $isoModule = Join-Path $iso 'AIEnrich.psm1'
            Copy-Item -LiteralPath $script:ModulePath -Destination $isoModule

            try {
                # 3>&1 captures the warning stream emitted during module load (no success output
                # without -PassThru, so only WarningRecords are collected).
                $warns = @(Import-Module $isoModule -Force 3>&1)
                $msg = ($warns | ForEach-Object { $_.ToString() }) -join ' '
                $msg | Should -Match 'ai-models\.json not found'
            }
            finally {
                Remove-Module AIEnrich -Force -ErrorAction SilentlyContinue
                # Restore the real module for any later tests in the run.
                Import-Module $script:ModulePath -Force -WarningAction SilentlyContinue
            }
        }
    }
}
