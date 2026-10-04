# Tag: taxonomy (t/3901)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-SituationBdiViolationsFromJson -- the pure, module-free BDI-violation
    classifier that the data-repo pre-commit hook (t/3892) uses, and that
    Test-SituationBdiCompliance -ChangedOnly now delegates to (t/3901).
.NOTES
    Fixtures are written via PowerShell's own `Set-Content -Encoding utf8BOM` + read
    back via `Get-Content -Raw`, matching how a real pre-commit hook would read
    `git show :0:situations.json` content -- not a hand-typed ASCII literal -- per the
    ticket's "BOM'd PowerShell-written fixtures" requirement.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:CleanNode = @'
{ "id": "sit-clean-1", "description": "A clean, fully decomposed situation with a sufficiently long description.",
  "interpretations": {
    "accelerationist": { "belief": "acc belief", "desire": "acc desire", "intention": "acc intention" },
    "safetyist":       { "belief": "saf belief", "desire": "saf desire", "intention": "saf intention" },
    "skeptic":         { "belief": "skp belief", "desire": "skp desire", "intention": "skp intention" } } }
'@
    $script:CleanNode2 = @'
{ "id": "sit-clean-2", "description": "A second clean, fully decomposed situation with a long-enough description.",
  "interpretations": {
    "accelerationist": { "belief": "b", "desire": "d", "intention": "i" },
    "safetyist":       { "belief": "b", "desire": "d", "intention": "i" },
    "skeptic":         { "belief": "b", "desire": "d", "intention": "i" } } }
'@
    # Legacy flat-string interpretations -- the exact non-decomposed shape 78c943cf shipped.
    $script:BadNode = @'
{ "id": "sit-bad-1", "description": "A non-decomposed situation carrying legacy flat-string interpretations.",
  "interpretations": {
    "accelerationist": "accelerationists welcome this",
    "safetyist":       "safetyists worry about this",
    "skeptic":         "skeptics doubt this" } }
'@

    # Write via Set-Content -Encoding utf8BOM (real PowerShell-written-file provenance),
    # read back via Get-Content -Raw (what a hook does) -- so fixture strings passed to
    # the function under test are byte-realistic, not hand-typed literals.
    function script:New-SitJsonString {
        param([Parameter(Mandatory)][string[]]$NodeJson)
        $body = '{ "nodes": [ ' + ($NodeJson -join ",`n") + ' ] }'
        $tmp = Join-Path $TestDrive ([System.IO.Path]::GetRandomFileName())
        Set-Content -LiteralPath $tmp -Value $body -Encoding utf8BOM
        return (Get-Content -Raw -LiteralPath $tmp)
    }
}

Describe 'Get-SituationBdiViolationsFromJson (t/3901)' -Tag 'taxonomy' {

    It 'a changed BAD (flat) situation produces a violation' {
        $baseline  = script:New-SitJsonString -NodeJson @($script:CleanNode)
        $candidate = script:New-SitJsonString -NodeJson @($script:CleanNode, $script:BadNode)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson $baseline -CandidateJson $candidate
        @($violations).Count | Should -BeGreaterThan 0
        $violations.id | Should -Contain 'sit-bad-1'
    }

    It 'a changed COMPLETE-BDI situation produces no violations' {
        $baseline  = script:New-SitJsonString -NodeJson @($script:CleanNode)
        $candidate = script:New-SitJsonString -NodeJson @($script:CleanNode, $script:CleanNode2)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson $baseline -CandidateJson $candidate
        @($violations).Count | Should -Be 0
    }

    It 'an untouched pre-existing BAD node is NOT re-flagged when a valid node changes elsewhere (changed-only)' {
        $baseline  = script:New-SitJsonString -NodeJson @($script:CleanNode, $script:BadNode)
        $candidate = script:New-SitJsonString -NodeJson @($script:CleanNode, $script:BadNode, $script:CleanNode2)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson $baseline -CandidateJson $candidate
        @($violations).Count | Should -Be 0
        $violations.id | Should -Not -Contain 'sit-bad-1'
    }

    It 'an empty baseline (first commit) treats a flat node as changed -> violation' {
        $candidate = script:New-SitJsonString -NodeJson @($script:BadNode)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson '' -CandidateJson $candidate
        $violations.id | Should -Contain 'sit-bad-1'
    }

    It 'a $null baseline is treated the same as an empty baseline (first commit)' {
        $candidate = script:New-SitJsonString -NodeJson @($script:BadNode)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson $null -CandidateJson $candidate
        $violations.id | Should -Contain 'sit-bad-1'
    }

    It 'a literal leading U+FEFF (BOM character) on the candidate string does not break parsing (t/3901#2, TL)' {
        # Get-Content -Raw strips a file's BOM, so this proves the function handles a
        # literal BOM CHARACTER in the string itself (e.g. from `git show` of a BOM'd
        # blob) -- PS7's ConvertFrom-Json otherwise rejects a leading U+FEFF outright.
        $bomChar = [char]0xFEFF
        $candidate = $bomChar + ('{ "nodes": [ ' + $script:BadNode + ' ] }')
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson '' -CandidateJson $candidate
        $violations.id | Should -Contain 'sit-bad-1'
    }

    It 'a literal leading U+FEFF (BOM character) on the baseline string does not break parsing (t/3901#2, TL)' {
        $bomChar = [char]0xFEFF
        $baseline  = $bomChar + ('{ "nodes": [ ' + $script:CleanNode + ' ] }')
        $candidate = script:New-SitJsonString -NodeJson @($script:CleanNode, $script:CleanNode2)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson $baseline -CandidateJson $candidate
        @($violations).Count | Should -Be 0
    }

    It 'unparseable candidate JSON THROWS (not an empty pass)' {
        $baseline = script:New-SitJsonString -NodeJson @($script:CleanNode)
        { Get-SituationBdiViolationsFromJson -BaselineJson $baseline -CandidateJson '{ not valid json' } |
            Should -Throw
    }

    It 'unparseable baseline JSON THROWS (not an empty pass)' {
        $candidate = script:New-SitJsonString -NodeJson @($script:CleanNode)
        { Get-SituationBdiViolationsFromJson -BaselineJson '{ not valid json' -CandidateJson $candidate } |
            Should -Throw
    }

    It 'a violation entry carries id, pov, and reason fields' {
        $candidate = script:New-SitJsonString -NodeJson @($script:BadNode)
        $violations = Get-SituationBdiViolationsFromJson -BaselineJson '' -CandidateJson $candidate
        @($violations).Count | Should -BeGreaterThan 0
        foreach ($v in $violations) {
            $v.id     | Should -Not -BeNullOrEmpty
            $v.pov    | Should -Not -BeNullOrEmpty
            $v.reason | Should -Not -BeNullOrEmpty
        }
    }
}

Describe 'Get-SituationBdiViolationsFromJson -- module-free load test (t/3901)' -Tag 'taxonomy' {

    It 'is callable from a fresh pwsh process via dot-sourcing ONLY the classifier + this file -- no Import-Module' {
        $classifierPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Private' 'Test-SituationBdiDecomposition.ps1'
        $fnPath         = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public'  'Get-SituationBdiViolationsFromJson.ps1'

        $candidate = '{ "nodes": [ ' + $script:BadNode + ' ] }'
        $candidateFile = Join-Path $TestDrive 'load-test-candidate.json'
        Set-Content -LiteralPath $candidateFile -Value $candidate -Encoding utf8BOM

        $psCmd = @"
. '$classifierPath'
. '$fnPath'
`$candidateText = Get-Content -Raw -LiteralPath '$candidateFile'
`$violations = Get-SituationBdiViolationsFromJson -BaselineJson '' -CandidateJson `$candidateText
if (@(`$violations).Count -eq 0) { Write-Output 'FAIL-NO-VIOLATIONS' } else { Write-Output "OK:`$(`$violations.Count)" }
"@
        $result = pwsh -NoProfile -Command $psCmd
        $resultLines = @($result | Where-Object { $_ -and $_.Trim() })
        $resultLines | Should -Not -BeNullOrEmpty
        $resultLines[-1] | Should -Match '^OK:\d+$'
    }
}
