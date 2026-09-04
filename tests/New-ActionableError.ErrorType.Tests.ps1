# Tag: error-handling (t/3307)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Coverage for the additive, optional -ErrorType parameter on New-ActionableError (t/3307).
.DESCRIPTION
    -ErrorType renders a `Type:` line ONLY when supplied, so the rendered message is byte-identical
    for the 40+ existing callers that don't pass it. New-ActionableError is private (dot-sourced),
    so it is exercised via InModuleScope.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'New-ActionableError -ErrorType (additive)' -Tag 'error-handling' {

    It 'renders a Type: line when -ErrorType is supplied' {
        InModuleScope AITriad {
            $msg = New-ActionableError -PassThru -ErrorType 'InsufficientReadableText' `
                -Goal 'g' -Problem 'p' -Location 'loc' -NextSteps @('do x')
            $msg | Should -Match 'Type:\s+InsufficientReadableText'
            # Ordering: Type sits between the Error and Location labels.
            $msg | Should -Match '(?s)Error:.*Type:.*Location:'
        }
    }

    It 'is byte-identical to the pre-existing render when -ErrorType is omitted (zero change for existing callers)' {
        InModuleScope AITriad {
            $msg = New-ActionableError -PassThru `
                -Goal 'g' -Problem 'p' -Location 'loc' -NextSteps @('do x', 'do y')
            $msg | Should -Not -Match 'Type:'
            # Normalize line endings — CRLF vs LF is a file-encoding artifact, not a behavior change.
            $norm = $msg -replace "`r`n", "`n"
            $expected = "`n  Goal:     g`n  Error:    p`n  Location: loc`n  Resolve:`n   1. do x`n   2. do y"
            $norm | Should -BeExactly $expected
        }
    }

    It 'omits the Type: line when -ErrorType is the empty string' {
        InModuleScope AITriad {
            $msg = New-ActionableError -PassThru -ErrorType '' `
                -Goal 'g' -Problem 'p' -Location 'loc' -NextSteps @('do x')
            $msg | Should -Not -Match 'Type:'
        }
    }
}
