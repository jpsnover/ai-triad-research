# Tag: unit (t/2530)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    L14 regression (t/2530): Protect-SensitiveText scrubs API keys / tokens from
    text (AI error bodies + exception messages) before it is logged. Pure PS,
    keyless — always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Protect-SensitiveText (t/2530 L14)' -Tag 'unit' {

    It 'redacts an explicitly-supplied literal secret' {
        InModuleScope AITriad {
            $out = Protect-SensitiveText -Text 'the key was sekret-value-abc in the body' -Secret 'sekret-value-abc'
            $out | Should -Not -Match 'sekret-value-abc'
            $out | Should -Match '\[REDACTED\]'
        }
    }

    It 'redacts a ?key= query parameter' {
        InModuleScope AITriad {
            (Protect-SensitiveText -Text 'GET https://api/models?key=AIzaSyABCDEF123456') | Should -Not -Match 'AIzaSy'
        }
    }

    It 'redacts a Google AIza key, a Bearer token, sk-, and gsk_ tokens' {
        InModuleScope AITriad {
            (Protect-SensitiveText -Text 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456') | Should -Not -Match 'AIzaSyABCDEF'
            (Protect-SensitiveText -Text 'Authorization: Bearer abc.def.ghijklmnop') | Should -Not -Match 'abc\.def\.ghijklmnop'
            (Protect-SensitiveText -Text 'sk-ant-api03-AAAAAAAAAAAAAAAA') | Should -Not -Match 'sk-ant-api03-A'
            (Protect-SensitiveText -Text 'gsk_ABCDEFGHIJKLMNOPQRST') | Should -Not -Match 'gsk_ABCDEFGH'
        }
    }

    It 'returns null/empty input unchanged' {
        InModuleScope AITriad {
            (Protect-SensitiveText -Text '') | Should -Be ''
            (Protect-SensitiveText -Text $null) | Should -BeNullOrEmpty
        }
    }

    It 'truncates output past MaxLength' {
        InModuleScope AITriad {
            $long = 'a' * 2000
            $out = Protect-SensitiveText -Text $long -MaxLength 100
            $out.Length | Should -BeLessThan 200
            $out | Should -Match 'truncated'
        }
    }

    It 'leaves benign text intact' {
        InModuleScope AITriad {
            (Protect-SensitiveText -Text 'model overloaded, please retry') | Should -Be 'model overloaded, please retry'
        }
    }
}
