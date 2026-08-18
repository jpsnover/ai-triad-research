# Tag: health (t/2775)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-PreloadHealth — validate the built preload.cjs artifact (t/2775).
.DESCRIPTION
    Filesystem-based (no mocking): each case builds a temp code root with a nested
    taxonomy-editor/dist/main/.../preload.cjs to exercise the recursive glob, then
    asserts the Healthy verdict + per-check results. Covers happy path, missing
    preload, missing bridge call, missing preloadBuffer, and -CheckSyntax.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-PreloadHealth (t/2775)' -Tag 'health' {

    BeforeEach {
        $script:Root  = Join-Path ([System.IO.Path]::GetTempPath()) "tph-$(New-Guid)"
        # Nested to match the real dist/main/taxonomy-editor/src/main/ layout.
        $script:MainDir = Join-Path $script:Root 'taxonomy-editor/dist/main/taxonomy-editor/src/main'
        New-Item -ItemType Directory -Path $script:MainDir -Force | Out-Null
    }

    AfterEach {
        Remove-Item -Path $script:Root -Recurse -Force -ErrorAction SilentlyContinue
    }

    function script:Get-Check ($result, $name) { $result.Checks | Where-Object { $_.Name -like "$name*" } }

    It 'Healthy for a self-contained preload with the bridge (no relative require, no preloadBuffer needed)' {
        # The correctly-fixed build (#1214) inlines the buffer — no preloadBuffer.cjs sibling.
        Set-Content -Path (Join-Path $script:MainDir 'preload.cjs') -Value 'const { contextBridge } = require("electron"); contextBridge.exposeInMainWorld("electronAPI", {});' -Encoding utf8

        $r = Test-PreloadHealth -CodeRoot $script:Root 6>$null
        $r.Healthy | Should -BeTrue -Because 'a self-contained preload with the bridge is healthy — the buffer sibling is inlined, not required'
        $r.PreloadPath | Should -BeLike '*preload.cjs'
        (Get-Check $r 'preload.cjs self-contained').Pass | Should -BeTrue
        @($r.Checks | Where-Object { -not $_.Pass }).Count | Should -Be 0
    }

    It 'Unhealthy + flags the built check when preload.cjs is absent' {
        # dist/main exists but no preload.cjs.
        $r = Test-PreloadHealth -CodeRoot $script:Root 6>$null
        $r.Healthy | Should -BeFalse
        $r.PreloadPath | Should -BeNullOrEmpty
        (Get-Check $r 'preload.cjs built').Pass | Should -BeFalse
    }

    It 'Flags the missing contextBridge.exposeInMainWorld call' {
        Set-Content -Path (Join-Path $script:MainDir 'preload.cjs') -Value 'console.log("no bridge here");' -Encoding utf8

        $r = Test-PreloadHealth -CodeRoot $script:Root 6>$null
        $r.Healthy | Should -BeFalse
        (Get-Check $r 'exposes electronAPI').Pass | Should -BeFalse
    }

    It 'Flags a relative sibling require — NOT self-contained (the t/2772 anti-pattern)' {
        # A preload that require()s ./preloadBuffer is the sandbox-breaking bug the fix removed.
        Set-Content -Path (Join-Path $script:MainDir 'preload.cjs') -Value 'const buf = require("./preloadBuffer"); contextBridge.exposeInMainWorld("electronAPI", {});' -Encoding utf8

        $r = Test-PreloadHealth -CodeRoot $script:Root 6>$null
        $r.Healthy | Should -BeFalse
        $selfCheck = Get-Check $r 'preload.cjs self-contained'
        $selfCheck.Pass   | Should -BeFalse
        $selfCheck.Detail | Should -Match 'relative require'
    }

    It 'A bare module require (electron) does NOT trip the self-contained check' {
        Set-Content -Path (Join-Path $script:MainDir 'preload.cjs') -Value 'const { contextBridge } = require("electron"); contextBridge.exposeInMainWorld("electronAPI", {});' -Encoding utf8

        $r = Test-PreloadHealth -CodeRoot $script:Root 6>$null
        (Get-Check $r 'preload.cjs self-contained').Pass | Should -BeTrue -Because 'only relative (./ ../) requires are the sandbox risk; bare module requires are fine'
    }

    It '-CheckSyntax passes on a valid preload and fails on a corrupt one' {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            Set-ItResult -Skipped -Because 'node not on PATH — syntax arm not run'
            return
        }
        Set-Content -Path (Join-Path $script:MainDir 'preload.cjs') -Value 'contextBridge.exposeInMainWorld("electronAPI", {});' -Encoding utf8
        $ok = Test-PreloadHealth -CodeRoot $script:Root -CheckSyntax 6>$null
        (Get-Check $ok 'node --check syntax').Pass | Should -BeTrue

        Set-Content -Path (Join-Path $script:MainDir 'preload.cjs') -Value 'contextBridge.exposeInMainWorld("electronAPI", {' -Encoding utf8  # unbalanced
        $bad = Test-PreloadHealth -CodeRoot $script:Root -CheckSyntax 6>$null
        (Get-Check $bad 'node --check syntax').Pass | Should -BeFalse
        $bad.Healthy | Should -BeFalse
    }

    It 'Is exported and resolvable after import' {
        Get-Command Test-PreloadHealth -Module AITriad -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }
}
