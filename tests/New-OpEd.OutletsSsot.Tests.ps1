# Tag: oped (t/3863)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    New-OpEd's dynamic -Outlet ValidateSet reads lib/oped/outlets.json (t/3863, t/3819 child C).
.DESCRIPTION
    t/3819#3 Condition 4 (fail CLOSED) and Condition 5 (caching) both required empirical
    investigation rather than assumption -- see t/3863#1. The load-bearing test here is the
    one Condition 4 names explicitly: with a malformed SSOT in place, passing ANY -Outlet
    (even a normally-valid one) must be refused AT PARAMETER BINDING -- proven by asserting
    the caught exception's TYPE is ParameterBindingValidationException, which can only ever
    be thrown by PowerShell's own binding engine, never by code inside the function body.
    An error from the body (the old, inert shape t/3856/t/3855 taught this session to
    distrust) would not distinguish fail-closed from fail-open.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-OpEdOutletsData (t/3863)' -Tag 'oped' {

    It 'reads the real outlets.json: 9 outlets, defaultOutlet, styleDefaults present' {
        InModuleScope AITriad {
            $Data = Get-OpEdOutletsData
            $Data.defaultOutlet | Should -Be 'TechPolicyPress'
            @($Data.outlets.PSObject.Properties.Name).Count | Should -Be 9
            $Data.styleDefaults.audience | Should -Not -BeNullOrEmpty
            $Data.styleDefaults.readability.fkMax | Should -Be 11
        }
    }

    It 'throws naming the file when outlets.json is missing -- fail CLOSED, not fail-open' {
        InModuleScope AITriad {
            Mock Test-Path { $false }
            { Get-OpEdOutletsData } | Should -Throw -ExpectedMessage '*outlets.json*not found*'
        }
    }

    It 'throws naming the parse failure when the file is malformed JSON' {
        InModuleScope AITriad {
            Mock Get-Content { 'not valid json at all {{{' }
            { Get-OpEdOutletsData } | Should -Throw -ExpectedMessage '*schema validation*'
        }
    }

    It 'throws naming the schema violation when the file is well-formed JSON but violates the schema' {
        InModuleScope AITriad {
            Mock Get-Content { '{"defaultOutlet": "X"}' }
            { Get-OpEdOutletsData } | Should -Throw -ExpectedMessage '*schema validation*'
        }
    }
}

Describe 'Get-OpEdOutletKeys (t/3863)' -Tag 'oped' {

    It 'returns all 9 outlet keys from the real SSOT' {
        InModuleScope AITriad {
            $Keys = Get-OpEdOutletKeys
            $Keys.Count | Should -Be 9
            $Keys | Should -Contain 'TechPolicyPress'
            $Keys | Should -Contain 'WashingtonPost'
        }
    }

    It 'propagates the throw (no swallow) when the SSOT cannot be read' {
        InModuleScope AITriad {
            Mock Test-Path { $false }
            { Get-OpEdOutletKeys } | Should -Throw -ExpectedMessage '*outlets.json*'
        }
    }
}

Describe 'New-OpEd -Outlet: refusal at binding, not merely an error (t/3863 Condition 4)' -Tag 'oped' {

    It 'refuses ANY -Outlet value at parameter binding when outlets.json is malformed -- the load-bearing test' {
        Mock Test-Path { $false } -ModuleName AITriad

        $Caught = $null
        try {
            # TechPolicyPress is normally valid -- the point is that it is refused too,
            # because the generator cannot prove ANY value is valid against a SSOT it
            # cannot read. An error from inside New-OpEd's body could not distinguish
            # fail-closed from fail-open; the exception TYPE is the proof.
            New-OpEd -Topic 'x' -Pov skeptic -Outlet 'TechPolicyPress' -VoiceOnly -ErrorAction Stop
        } catch {
            $Caught = $_
        }

        $Caught | Should -Not -BeNullOrEmpty
        # [ParameterBindingValidationException] does not resolve as a type literal here
        # (confirmed empirically, t/3863) -- compare the type name as a string instead.
        $Caught.Exception.GetType().FullName | Should -Be 'System.Management.Automation.ParameterBindingValidationException'
        $Caught.Exception.Message | Should -Match 'outlets\.json'
        $Caught.Exception.Message | Should -Match 'not found'
    }

    It 'still accepts a valid -Outlet when outlets.json is healthy (regression guard on the fix above)' {
        Mock Invoke-AIApi { [PSCustomObject]@{ Text = (@{ headline = 'H'; body_markdown = 'one two'; word_count = 2 } | ConvertTo-Json); Backend = 'gemini' } } -ModuleName AITriad
        { New-OpEd -Topic 'x' -Pov skeptic -Outlet 'TechPolicyPress' -VoiceOnly } | Should -Not -Throw
    }
}

Describe 'New-OpEd outlet resolution: byte-identical to the pre-SSOT hardcoded values (t/3863)' -Tag 'oped' {

    It 'resolves all 9 outlets'' words to the frozen pre-SSOT values' {
        InModuleScope AITriad {
            $Expected = @{
                WashingtonPost = 800; NYTimes = 800; WallStreetJournal = 900; USAToday = 650
                ForeignAffairs = 1200; Politico = 1000; Regional = 650; Generic = 800; TechPolicyPress = 1500
            }
            $Data = Get-OpEdOutletsData
            foreach ($Key in $Expected.Keys) {
                $Data.outlets.$Key.words | Should -Be $Expected[$Key] -Because "outlet '$Key' words must match the pre-SSOT hardcoded value"
            }
        }
    }

    It 'resolves styleDefaults'' 6 prose fields + readability to the frozen pre-SSOT values' {
        InModuleScope AITriad {
            $Data = Get-OpEdOutletsData
            $Data.styleDefaults.audience | Should -Be 'persuade a broad, non-specialist public to act'
            $Data.styleDefaults.bodyFormat | Should -Match 'No section labels or headers'
            $Data.styleDefaults.readability.fkMax | Should -Be 11
            $Data.styleDefaults.readability.maxSentWords | Should -Be 30
            $Data.styleDefaults.readability.maxParaWords | Should -Be 90
        }
    }

    It 'resolves TechPolicyPress''s style + readability overrides to the frozen pre-SSOT values' {
        InModuleScope AITriad {
            $Entry = (Get-OpEdOutletsData).outlets.TechPolicyPress
            $Entry.style.sentenceMechanics | Should -Match 'no sentence over 40 words'
            $Entry.style.bodyFormat | Should -Match '3-5 sections'
            $Entry.readability.fkMax | Should -Be 16
            $Entry.readability.maxSentWords | Should -Be 40
            $Entry.readability.maxParaWords | Should -Be 120
        }
    }
}
