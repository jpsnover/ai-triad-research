# Tag: unit (t/3195)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/3195: ConvertFrom-TruncatableJson parses valid JSON, recovers the valid prefix of a
    truncated structured-output response (so entity-dense nodes no longer hard-fail), and
    re-throws the original error when the text is genuinely unrepairable.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'ConvertFrom-TruncatableJson (t/3195)' -Tag 'unit' {

    It 'is exported from the module (parallel-runspace reachable)' {
        Get-Command -Module AITriad -Name 'ConvertFrom-TruncatableJson' | Should -Not -BeNullOrEmpty
    }

    It 'passes valid JSON straight through' {
        $o = ConvertFrom-TruncatableJson -Text '{"proposals":[{"name":"A"}],"org_mentions":[]}'
        @($o.proposals).Count | Should -Be 1
        $o.proposals[0].name | Should -Be 'A'
    }

    It 'recovers the valid prefix when the proposals array is truncated mid-string' {
        # Mimics the t/3195 failure: response cut off inside proposals[2].quote.
        $truncated = '{"proposals":[' +
            '{"name":"Apollo","entity_type":"event","aliases":[],"quote":"q1","confidence":0.9},' +
            '{"name":"Gemini","entity_type":"artifact","aliases":[],"quote":"q2","confidence":0.8},' +
            '{"name":"Partial","entity_type":"person","aliases":[],"quote":"this string was cut off mid-w'
        $warn = @()
        $o = ConvertFrom-TruncatableJson -Text $truncated -Context 'skp-beliefs-001' -WarningVariable warn -WarningAction SilentlyContinue

        # The two complete proposals survive; the partial trailing one is dropped by the repair.
        @($o.proposals).Count | Should -BeGreaterOrEqual 2
        $o.proposals[0].name | Should -Be 'Apollo'
        $o.proposals[1].name | Should -Be 'Gemini'
        # Fallback-path WARN fired with the node context.
        ($warn -join ' ') | Should -Match 'truncated'
        ($warn -join ' ') | Should -Match 'skp-beliefs-001'
    }

    It 're-throws the original parse error when the text is unrepairable' {
        { ConvertFrom-TruncatableJson -Text 'not json at all {{{' -WarningAction SilentlyContinue } | Should -Throw
    }
}
