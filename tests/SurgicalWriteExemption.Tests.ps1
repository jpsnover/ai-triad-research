# Tag: summary (t/2916) — GATE-TOUCHING: the -SurgicalWrite exemption on the BLOCK-tier
#   dirty-tree guard. Routed to Main (TL) for both-arms Gate Verification.
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both-arms GV for the surgical-write exemption (t/2916 Fork 2, TL ruling t/2916#8).

    A field-surgical write is sweep-proof BY CONSTRUCTION (the re-parse-verify invariant +
    byte-identical foreign-WIP preservation proven in Update-JsonNodeField tests 5/7), so
    it MUST be exempt from the BLOCK-tier dirty-tree throw — otherwise the guard blocks the
    one writer that is actually safe on a dirty tree, defeating the entire point of t/2916.

    The exemption is a DISTINCT signal (-SurgicalWrite), NOT overloaded onto -AllowDirty
    (TL: -AllowDirty = "tree is dirty, I choose to ignore it" [blanket override];
    -SurgicalWrite = "this write is sweep-proof, the dirty check is N/A" [provably safe]).
    Two different risk profiles must not share a flag.

    Both arms:
      ARM 1 — a surgical write to a dirty BLOCK-tier target PROCEEDS.
      ARM 2 — the SAME write WITHOUT the surgical signal is BLOCKED.
    Plus the reachability gate: only Save-JsonNodeFieldEdits may claim the exemption, so a
    whole-file writer cannot regress to claiming the bypass.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Surgical-write exemption — both-arms GV (t/2916 Fork 2)' -Tag 'summary' {

    It 'ARM 1 — a surgical write to a dirty BLOCK-tier target PROCEEDS (exemption honored)' {
        InModuleScope AITriad {
            Mock Get-DataWriteGuardMode { 'Block' }
            Mock Test-IsUnderDataRoot   { $true }
            Mock Assert-CleanDataTree   { throw 'dirty tree (simulated)' }   # would block a whole-file write
            { Assert-DataWriteAllowed -Path 'X:\data\taxonomy\situations.json' -SurgicalWrite } | Should -Not -Throw
            # the exemption returns BEFORE the dirty check — the tree is never even consulted
            Should -Invoke Assert-CleanDataTree -Times 0
        }
    }

    It 'ARM 2 — the SAME whole-file write WITHOUT the surgical signal is BLOCKED' {
        InModuleScope AITriad {
            Mock Get-DataWriteGuardMode { 'Block' }
            Mock Test-IsUnderDataRoot   { $true }
            Mock Assert-CleanDataTree   { throw 'dirty tree (simulated)' }
            { Assert-DataWriteAllowed -Path 'X:\data\taxonomy\situations.json' } | Should -Throw
        }
    }

    It 'the surgical signal is a DISTINCT parameter, not overloaded onto -AllowDirty' {
        InModuleScope AITriad {
            $p = (Get-Command Assert-DataWriteAllowed).Parameters.Keys
            $p | Should -Contain 'SurgicalWrite'
            $p | Should -Contain 'AllowDirty'
        }
    }

    It 'Write-Utf8NoBom forwards the surgical signal to the guard' {
        InModuleScope AITriad {
            (Get-Command Write-Utf8NoBom).Parameters.Keys | Should -Contain 'SurgicalWrite'
        }
    }
}

Describe 'Surgical-write exemption — reachable ONLY via the orchestrator (detection gate)' -Tag 'summary' {

    It 'no data writer other than Save-JsonNodeFieldEdits claims -SurgicalWrite' {
        # Enforces TL t/2916#8: the exemption is claimed ONLY inside the orchestrator, so a
        # whole-file writer cannot regress to whole-file and silently keep the bypass.
        # Allowed: the orchestrator (claims it), the sink (forwards it), the guard (declares it).
        $scriptsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' 'scripts')).Path
        $allowed = @('Save-JsonNodeFieldEdits.ps1', 'Write-Utf8NoBom.ps1', 'Assert-DataWriteAllowed.ps1')
        $violations = @(
            Get-ChildItem -Path $scriptsRoot -Recurse -Filter '*.ps1' -File |
                Where-Object { $_.Name -notin $allowed } |
                Where-Object { Select-String -Path $_.FullName -Pattern '-SurgicalWrite' -SimpleMatch -Quiet } |
                ForEach-Object { $_.FullName }
        )
        $violations | Should -BeNullOrEmpty -Because 'only Save-JsonNodeFieldEdits may claim the surgical exemption; a whole-file writer must not bypass the BLOCK tier'
    }
}
