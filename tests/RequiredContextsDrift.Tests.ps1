# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Arms for the t/3646 required-contexts drift comparator (RequiredContextsDriftVerdict.ps1).
.DESCRIPTION
    The SSOT is a mirror of branch protection; a drifted mirror makes workflow-lint enforce the wrong
    set. These test the pure set-comparison (no network): in-sync (order-insensitive), over-claim
    (SSOT has extra), under-claim (API has extra), and both directions at once.
#>

Describe 'Get-RequiredContextsDriftVerdict (t/3646)' -Tag 'devops' {

    BeforeAll {
        . "$PSScriptRoot/../operations/devops/RequiredContextsDriftVerdict.ps1"
    }

    It 'IN SYNC — same set, different order' {
        $v = Get-RequiredContextsDriftVerdict -Ssot @('ci-gate', 'joint-gv-guard', 'CodeQL') -Api @('CodeQL', 'ci-gate', 'joint-gv-guard')
        $v.InSync | Should -BeTrue
        @($v.MissingFromApi).Count | Should -Be 0
        @($v.MissingFromSsot).Count | Should -Be 0
    }

    It 'over-claim — SSOT lists a context branch protection does NOT require' {
        $v = Get-RequiredContextsDriftVerdict -Ssot @('ci-gate', 'CodeQL', 'ghost-gate') -Api @('ci-gate', 'CodeQL')
        $v.InSync | Should -BeFalse
        $v.MissingFromApi | Should -Be @('ghost-gate')
        @($v.MissingFromSsot).Count | Should -Be 0
    }

    It 'under-claim — branch protection requires a context MISSING from the SSOT' {
        $v = Get-RequiredContextsDriftVerdict -Ssot @('ci-gate') -Api @('ci-gate', 'CodeQL')
        $v.InSync | Should -BeFalse
        @($v.MissingFromApi).Count | Should -Be 0
        $v.MissingFromSsot | Should -Be @('CodeQL')
    }

    It 'both directions — over- and under-claim at once' {
        $v = Get-RequiredContextsDriftVerdict -Ssot @('ci-gate', 'old-gate') -Api @('ci-gate', 'new-gate')
        $v.InSync | Should -BeFalse
        $v.MissingFromApi | Should -Be @('old-gate')
        $v.MissingFromSsot | Should -Be @('new-gate')
    }

    It 'dedupes and trims whitespace before comparing' {
        $v = Get-RequiredContextsDriftVerdict -Ssot @('ci-gate', ' ci-gate ', 'CodeQL') -Api @('CodeQL', 'ci-gate')
        $v.InSync | Should -BeTrue
    }
}
