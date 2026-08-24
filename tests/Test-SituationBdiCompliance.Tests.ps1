# Tag: taxonomy (t/3011)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Gate tests for Test-SituationBdiCompliance — the Layer A validation core of the
    INCIDENT-B data-boundary prevention (t/3007 / t/3011).
.NOTES
    Both-arms coverage (TL GV condition t/3011#2):
      - a deliberately non-decomposed situation FIRES the gate (Pass=false; and
        -FailOnViolation throws);
      - a clean corpus passes SILENT (Pass=true; -FailOnViolation does not throw).
    Plus -ChangedOnly scoping against a real temp git repo: only new/modified
    situations are validated; a pre-existing non-decomposed node that is untouched is
    NOT re-flagged; an unresolvable baseline fails safe to a full scan.

    All tests pass -SituationsPath at a $TestDrive fixture so they never touch the
    live ai-triad-data corpus.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Production-shaped node fragments (parsed exactly like situations.json nodes).
    $script:CleanNode1 = @'
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
    # Legacy flat-string interpretations — the exact non-decomposed shape 78c943cf shipped.
    $script:BadNode = @'
{ "id": "sit-bad-1", "description": "A non-decomposed situation carrying legacy flat-string interpretations.",
  "interpretations": {
    "accelerationist": "accelerationists welcome this",
    "safetyist":       "safetyists worry about this",
    "skeptic":         "skeptics doubt this" } }
'@
    $script:DepNode = @'
{ "id": "sit-dep-1", "description": "[DEPRECATED] superseded situation, exempt from the check.",
  "interpretations": {} }
'@

    function script:Write-SitFixture {
        param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string[]]$NodeJson)
        $body = '{ "nodes": [ ' + ($NodeJson -join ",`n") + ' ] }'
        Set-Content -LiteralPath $Path -Value $body -Encoding utf8
    }
}

Describe 'Test-SituationBdiCompliance — full-corpus validation (t/3011)' -Tag 'taxonomy' {

    It 'CLEAN arm: a fully-decomposed corpus passes silent (Pass=true, Fail=0)' {
        $f = Join-Path $TestDrive 'clean.json'
        script:Write-SitFixture -Path $f -NodeJson @($script:CleanNode1, $script:CleanNode2, $script:DepNode)
        $r = Test-SituationBdiCompliance -SituationsPath $f
        $r.Pass | Should -BeTrue
        $r.Fail | Should -Be 0
        $r.Scope | Should -Be 'Full'
        $r.NonDeprecated | Should -Be 2
        $r.Detail | Should -Match 'carry full per-POV BDI decomposition'
    }

    It 'FIRES arm: a non-decomposed situation fails (Pass=false; flagged id surfaced)' {
        $f = Join-Path $TestDrive 'dirty.json'
        script:Write-SitFixture -Path $f -NodeJson @($script:CleanNode1, $script:BadNode)
        $r = Test-SituationBdiCompliance -SituationsPath $f
        $r.Pass | Should -BeFalse
        $r.Fail | Should -Be 1
        $r.ViolationIds | Should -Contain 'sit-bad-1'
        $r.NonDecomposedIds | Should -Contain 'sit-bad-1'
    }

    It '-FailOnViolation THROWS on a dirty corpus (non-zero exit for the gate)' {
        $f = Join-Path $TestDrive 'dirty2.json'
        script:Write-SitFixture -Path $f -NodeJson @($script:CleanNode1, $script:BadNode)
        { Test-SituationBdiCompliance -SituationsPath $f -FailOnViolation } | Should -Throw
    }

    It '-FailOnViolation does NOT throw on a clean corpus (silent pass)' {
        $f = Join-Path $TestDrive 'clean2.json'
        script:Write-SitFixture -Path $f -NodeJson @($script:CleanNode1, $script:CleanNode2)
        { Test-SituationBdiCompliance -SituationsPath $f -FailOnViolation } | Should -Not -Throw
        # Capture separately (assignment inside a Should scriptblock does not escape its scope).
        $r = Test-SituationBdiCompliance -SituationsPath $f -FailOnViolation
        $r.Pass | Should -BeTrue
    }

    It 'exempts a [DEPRECATED] situation from the non-deprecated set' {
        $f = Join-Path $TestDrive 'dep.json'
        script:Write-SitFixture -Path $f -NodeJson @($script:CleanNode1, $script:DepNode)
        $r = Test-SituationBdiCompliance -SituationsPath $f
        $r.Pass | Should -BeTrue
        $r.NonDeprecated | Should -Be 1
    }

    It 'throws an ActionableError when situations.json is missing' {
        $missing = Join-Path $TestDrive 'nope.json'
        { Test-SituationBdiCompliance -SituationsPath $missing } |
            Should -Throw -ExpectedMessage '*situations.json not found*'
    }
}

Describe 'Test-SituationBdiCompliance — -ChangedOnly git-baseline scoping (t/3011)' -Tag 'taxonomy' {

    # git is a hard repo/CI dependency, so these run unconditionally (no discovery-time
    # skip — a -Skip computed in BeforeAll evaluates as $null at discovery and skips all).
    BeforeAll {
        function script:New-DataRepo {
            param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string[]]$BaselineNodes)
            $repo = Join-Path $TestDrive $Name
            New-Item -ItemType Directory -Path $repo -Force | Out-Null
            & git -C $repo init -q
            & git -C $repo config user.email 'test@example.com'
            & git -C $repo config user.name  'Test'
            $sit = Join-Path $repo 'situations.json'
            script:Write-SitFixture -Path $sit -NodeJson $BaselineNodes
            & git -C $repo add situations.json
            & git -C $repo commit -qm 'baseline'
            return $sit
        }
    }

    It 'validates ONLY the newly-added situation, not untouched pre-existing nodes' {
        # Baseline: two clean nodes committed. Then add a bad node (new).
        $sit = script:New-DataRepo -Name 'repo-add' -BaselineNodes @($script:CleanNode1, $script:CleanNode2)
        script:Write-SitFixture -Path $sit -NodeJson @($script:CleanNode1, $script:CleanNode2, $script:BadNode)
        $r = Test-SituationBdiCompliance -SituationsPath $sit -ChangedOnly -BaseRef HEAD
        $r.Scope   | Should -Be 'Changed'
        $r.Checked | Should -Be 1
        $r.Pass    | Should -BeFalse
        $r.ViolationIds | Should -Contain 'sit-bad-1'
    }

    It 'does NOT re-flag a pre-existing non-decomposed node that is untouched' {
        # Baseline already contains a bad node. Add a NEW clean node only.
        $sit = script:New-DataRepo -Name 'repo-preexisting' -BaselineNodes @($script:CleanNode1, $script:BadNode)
        script:Write-SitFixture -Path $sit -NodeJson @($script:CleanNode1, $script:BadNode, $script:CleanNode2)
        $r = Test-SituationBdiCompliance -SituationsPath $sit -ChangedOnly -BaseRef HEAD
        $r.Scope   | Should -Be 'Changed'
        $r.Checked | Should -Be 1          # only sit-clean-2 (the added node)
        $r.Pass    | Should -BeTrue        # the pre-existing bad node is out of scope
    }

    It 'flags a pre-existing node MODIFIED into a non-decomposed state' {
        # Baseline: clean node. Then rewrite that same id to a flat-string shape.
        $sit = script:New-DataRepo -Name 'repo-modify' -BaselineNodes @($script:CleanNode1, $script:CleanNode2)
        $mutated = $script:CleanNode1 -replace '(?s)"interpretations".*', '"interpretations": { "accelerationist": "x", "safetyist": "y", "skeptic": "z" } }'
        script:Write-SitFixture -Path $sit -NodeJson @($mutated, $script:CleanNode2)
        $r = Test-SituationBdiCompliance -SituationsPath $sit -ChangedOnly -BaseRef HEAD
        $r.Pass | Should -BeFalse
        $r.ViolationIds | Should -Contain 'sit-clean-1'
    }

    It 'passes clean when only a compliant node is added' {
        $sit = script:New-DataRepo -Name 'repo-cleanadd' -BaselineNodes @($script:CleanNode1)
        script:Write-SitFixture -Path $sit -NodeJson @($script:CleanNode1, $script:CleanNode2)
        $r = Test-SituationBdiCompliance -SituationsPath $sit -ChangedOnly -BaseRef HEAD
        $r.Scope | Should -Be 'Changed'
        $r.Pass  | Should -BeTrue
    }

    It 'fails safe to a FULL scan (with a warning) when the baseline ref is unresolvable' {
        $sit = script:New-DataRepo -Name 'repo-badref' -BaselineNodes @($script:CleanNode1, $script:BadNode)
        # Rewrite working copy (irrelevant here) and use a ref that does not exist.
        $r = Test-SituationBdiCompliance -SituationsPath $sit -ChangedOnly -BaseRef 'no-such-ref' -WarningAction SilentlyContinue
        $r.Scope | Should -Be 'Full'      # fell back to full corpus
        $r.Pass  | Should -BeFalse        # full scan sees the pre-existing bad node
        $r.ViolationIds | Should -Contain 'sit-bad-1'
    }
}
