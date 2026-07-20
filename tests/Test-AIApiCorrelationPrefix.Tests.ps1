# Tag: enrichment (t/1647)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for the t/1647 [AI] log-line doc-correlation prefix.
.DESCRIPTION
    In a parallel batch (ForEach-Object -Parallel, one worker runspace per doc)
    the "[AI] Backend: ..." line fired per AI call with no per-doc context, so an
    interleaved backend line could not be attributed to the document that
    produced it. The fix adds a runspace-local correlation token
    (Set-AIApiCorrelationId) that Invoke-AIApi prepends to every log line, via
    the shared Get-AIApiCorrelationPrefix formatter.

    These tests exercise the EXACT production formatter (not a copy) inside the
    AIEnrich module scope: set the token -> prefix names the doc; clear it ->
    prefix is empty (single-doc output unaffected, AC#2).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe '[AI] log-line doc-correlation prefix' -Tag 'enrichment' {

    It 'Prefixes the doc id when a correlation token is set' {
        InModuleScope AIEnrich {
            Set-AIApiCorrelationId 'clean-energy-resources'
            try {
                Get-AIApiCorrelationPrefix | Should -Be 'clean-energy-resources | ' `
                    -Because 'a set token must name the doc so an interleaved [AI] line is attributable (AC#1)'
            } finally {
                Set-AIApiCorrelationId ''
            }
        }
    }

    It 'Emits an empty prefix when no correlation token is set (single-doc output unaffected)' {
        InModuleScope AIEnrich {
            Set-AIApiCorrelationId ''
            Get-AIApiCorrelationPrefix | Should -Be '' `
                -Because 'standalone single-doc runs set no token, so output must be unprefixed (AC#2)'
        }
    }

    It 'Treats a whitespace-only token as unset' {
        InModuleScope AIEnrich {
            Set-AIApiCorrelationId '   '
            try {
                Get-AIApiCorrelationPrefix | Should -Be '' `
                    -Because 'whitespace is not a usable correlation id and must not emit a bare " | " prefix'
            } finally {
                Set-AIApiCorrelationId ''
            }
        }
    }

    It 'Clears a previously-set token back to an empty prefix' {
        InModuleScope AIEnrich {
            Set-AIApiCorrelationId 'doc-a'
            Set-AIApiCorrelationId ''
            Get-AIApiCorrelationPrefix | Should -Be '' `
                -Because 'clearing the token (empty string) must fully reset the prefix between docs'
        }
    }

    It 'Overwrites an existing token when a new doc sets its own (no cross-doc bleed within a runspace)' {
        InModuleScope AIEnrich {
            Set-AIApiCorrelationId 'doc-first'
            Set-AIApiCorrelationId 'doc-second'
            try {
                Get-AIApiCorrelationPrefix | Should -Be 'doc-second | ' `
                    -Because 'each doc overwrites the token at its set-point; the latest doc wins'
            } finally {
                Set-AIApiCorrelationId ''
            }
        }
    }
}
