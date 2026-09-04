# Tag: erroring (t/3307)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for New-ActionableError's -ErrorType and -AsErrorRecord options (t/3307).
.DESCRIPTION
    -ErrorType and -AsErrorRecord are optional/backward-compatible additions so a subprocess shim can
    serialize a structured failure ({ErrorType,Goal,Problem,NextSteps}) WITHOUT parsing the rendered
    human message. Verifies structured propagation via TargetObject, the rendered Type: line, and that
    pre-existing default/-PassThru/-Throw behavior is unchanged. New-ActionableError is private, so
    exercised via InModuleScope.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'New-ActionableError -AsErrorRecord / -ErrorType' -Tag 'erroring' {

    It '-AsErrorRecord returns an ErrorRecord whose TargetObject carries the structured fields' {
        $rec = InModuleScope AITriad {
            New-ActionableError -AsErrorRecord -ErrorType 'ContentPathMissing' `
                -Goal 'G' -Problem 'P' -Location 'L' -NextSteps @('one', 'two')
        }
        $rec        | Should -BeOfType [System.Management.Automation.ErrorRecord]
        $to = $rec.TargetObject
        $to.ErrorType | Should -Be 'ContentPathMissing'
        $to.Goal      | Should -Be 'G'
        $to.Problem   | Should -Be 'P'
        $to.Location  | Should -Be 'L'
        @($to.NextSteps).Count | Should -Be 2
        $rec.FullyQualifiedErrorId | Should -Match 'ContentPathMissing'
    }

    It '-ErrorType renders a Type: line in the -PassThru message' {
        $msg = InModuleScope AITriad {
            New-ActionableError -PassThru -ErrorType 'ConversionFailed' `
                -Goal 'G' -Problem 'P' -Location 'L' -NextSteps @('x')
        }
        $msg | Should -Match 'Type:\s+ConversionFailed'
    }

    It 'omits the Type: line when -ErrorType is not supplied (backward compatible)' {
        $msg = InModuleScope AITriad {
            New-ActionableError -PassThru -Goal 'G' -Problem 'P' -Location 'L' -NextSteps @('x')
        }
        $msg | Should -Not -Match 'Type:'
        # Rendered labels unchanged (t/2952): Goal/Error/Location/Resolve.
        $msg | Should -Match 'Goal:'
        $msg | Should -Match 'Error:'
        $msg | Should -Match 'Location:'
        $msg | Should -Match 'Resolve:'
    }

    It 'still throws the rendered string with -Throw (unchanged path)' {
        {
            InModuleScope AITriad {
                New-ActionableError -Throw -Goal 'G' -Problem 'boom' -Location 'L' -NextSteps @('x')
            }
        } | Should -Throw -ExpectedMessage '*boom*'
    }
}
