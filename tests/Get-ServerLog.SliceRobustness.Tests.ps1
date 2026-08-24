# Tag: azure (t/2861)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Get-ServerLog robustness to az connection chrome + sliced (>16KB) log lines (t/2861).
.DESCRIPTION
    ACA/Fluent Bit slices pino lines past ~16KB (t/2860); az also prints connection
    chrome. Asserts Get-ServerLog strips the chrome, suppresses meaningless TAIL slice
    fragments, still surfaces HEAD slices (with requestId) under -Raw, keeps parsing
    intact lines, and warns with a count.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-ServerLog slice/preamble robustness (t/2861)' -Tag 'azure' {

    BeforeEach {
        # az emits: connection chrome, one intact envelope (req-1), a TAIL slice
        # ('completed"}'), and a HEAD slice (starts with '{', carries req-2 but no
        # closing brace). Envelopes are the ACA {TimeStamp,Log} wrapper.
        Mock -ModuleName AITriad az {
            $global:LASTEXITCODE = 0
            @(
                "Connecting to the container 'taxonomy-editor'...",
                "Successfully Connected to container: 'taxonomy-editor--rev-xyz'",
                (@{ TimeStamp = 't'; Log = (@{ level = 30; time = 1755648000000; requestId = 'req-1'; component = 'ai'; msg = 'ok' } | ConvertTo-Json -Compress) } | ConvertTo-Json -Compress),
                (@{ TimeStamp = 't'; Log = 'completed"}' } | ConvertTo-Json -Compress),
                (@{ TimeStamp = 't'; Log = '{"level":30,"requestId":"req-2","big":"aaaaaaaaaaaaaaaa' } | ConvertTo-Json -Compress)
            )
        }
    }

    It 'strips az connection chrome from -Raw output' {
        $out = @(Get-ServerLog -Tail 5 -Raw -WarningAction SilentlyContinue)
        ($out -join "`n") | Should -Not -Match 'Connecting to the container'
        ($out -join "`n") | Should -Not -Match 'Successfully Connected'
    }

    It 'suppresses TAIL slice fragments but surfaces HEAD slices under -Raw' {
        $out = @(Get-ServerLog -Tail 5 -Raw -WarningAction SilentlyContinue)
        ($out -join "`n") | Should -Not -Match 'completed"\}'       # tail noise dropped
        ($out -join "`n") | Should -Match 'req-2'                    # head slice kept (has requestId)
        ($out -join "`n") | Should -Match 'req-1'                    # intact line kept
    }

    It 'warns with a count referencing t/2860 when slices are present' {
        $w = $null
        Get-ServerLog -Tail 5 -Raw -WarningVariable w -WarningAction SilentlyContinue | Out-Null
        @($w) -join ';' | Should -Match 'unparseable'
        @($w) -join ';' | Should -Match 't/2860'
    }

    It 'still parses intact lines into structured objects (slices excluded)' {
        $objs = @(Get-ServerLog -Tail 5 -WarningAction SilentlyContinue)
        $objs.Count | Should -Be 1
        $objs[0].RequestId | Should -Be 'req-1'
        $objs[0].Level | Should -Be 'info'
    }

    It 'does not emit chrome or tail slices even when they dominate the window' {
        $objs = @(Get-ServerLog -Tail 5 -WarningAction SilentlyContinue)
        ($objs | ForEach-Object { $_.Message }) | Should -Not -Contain 'completed"}'
    }
}
