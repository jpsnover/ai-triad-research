# Tag: ingestion (t/1726)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for t/1726 — strict-mode crash when the LLM omits
    factual_claims from a summary response.
.DESCRIPTION
    AITriad.psm1 sets `Set-StrictMode -Version Latest` globally. Under strict
    mode, accessing a non-existent property on a PSCustomObject THROWS — even in
    a boolean `if ($x.factual_claims)` test. When the model returns JSON without
    `factual_claims` (reproducible with small docs), `ConvertFrom-Json` yields a
    PSCustomObject lacking the property, and the summary-extraction helpers that
    read it unguarded explode inside a `ForEach-Object -Parallel` runspace.

    These tests exercise the two guarded helpers DIRECTLY (not through the
    parallel batch wrapper, which mis-attributes the failing line), with a
    fixture that genuinely OMITS factual_claims — the omitted field is the whole
    point, so a fixture-integrity test guards against it silently regaining the
    field. Test-FireRequired is the Stage-5 post-extraction sniff; the crash
    surfaces there first in single-shot mode. Remove-DuplicateClaims is Stage-5c.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Summary pipeline tolerates an LLM response omitting factual_claims (t/1726)' -Tag 'ingestion' {

    BeforeEach {
        # A summary exactly as ConvertFrom-Json produces it when the model omits
        # factual_claims — the property is ABSENT, not null/empty. pov_summaries
        # present so the helpers do real work before reaching the guarded access.
        $script:NoClaimsJson = @'
{
  "pov_summaries": {
    "accelerationist": { "key_points": [ { "point": "acceleration is inevitable" } ] },
    "safetyist":       { "key_points": [] },
    "skeptic":         { "key_points": [] }
  },
  "unmapped_concepts": []
}
'@
    }

    It 'fixture integrity: the parsed object genuinely OMITS factual_claims' {
        $obj = $script:NoClaimsJson | ConvertFrom-Json
        $obj.PSObject.Properties['factual_claims'] |
            Should -BeNullOrEmpty -Because 'the regression is meaningless unless the fixture reproduces the missing-property condition'
    }

    It 'Test-FireRequired (Stage-5 post-extraction sniff) does not throw and returns a decision' {
        InModuleScope AITriad -Parameters @{ Json = $script:NoClaimsJson } {
            param($Json)
            $obj = $Json | ConvertFrom-Json
            # Direct call: a strict-mode missing-property throw fails the test at
            # the real Test-FireRequired line, not a mis-attributed parallel line.
            $result = Test-FireRequired -SummaryObject $obj
            $result | Should -Not -BeNullOrEmpty -Because 'a missing factual_claims field must be treated as zero claims, not a crash (t/1726)'
            $result.PSObject.Properties['ShouldFire'] |
                Should -Not -BeNullOrEmpty -Because 'the sniff must still return a valid decision object'
        }
    }

    It 'Remove-DuplicateClaims (Stage-5c dedup) does not throw when factual_claims is omitted' {
        InModuleScope AITriad -Parameters @{ Json = $script:NoClaimsJson } {
            param($Json)
            $obj = $Json | ConvertFrom-Json
            { Remove-DuplicateClaims -SummaryObject $obj } |
                Should -Not -Throw -Because 'the dedup metrics pass reads factual_claims unguarded at the old line 107 (t/1726)'
        }
    }

    It 'Test-FireRequired treats a present-but-empty factual_claims array the same (no regression for the normal path)' {
        InModuleScope AITriad {
            $obj = '{ "pov_summaries": { "accelerationist": { "key_points": [] }, "safetyist": { "key_points": [] }, "skeptic": { "key_points": [] } }, "factual_claims": [], "unmapped_concepts": [] }' | ConvertFrom-Json
            { Test-FireRequired -SummaryObject $obj } |
                Should -Not -Throw -Because 'an explicit empty array must behave identically to an omitted field'
        }
    }
}
