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

    # Shared detector (t/2916#10 hardening) — defined in BeforeAll so it is visible to It
    # blocks at run time. Scans REPO-WIDE *.ps1 (InModuleScope reach — a writer can live
    # outside scripts/), and matches ABBREVIATED params: `-Surg` binds -SurgicalWrite and
    # evades a -SimpleMatch on the full name. The negative lookbehind `(?<![\w-])` requires
    # a real parameter boundary before the dash, so the English word "field-surgical" in a
    # comment (preceded by a word char) is NOT a false positive, while " -SurgicalWrite" /
    # " -Surg" (preceded by whitespace) is. Vendored/checkout trees are excluded.
    function Get-SurgicalExemptionViolations {
        # Scans REPO-WIDE for unauthorized claims of the surgical-write exemption.
        # PS files: matches -SurgicalWrite and any abbreviation (e.g. -Surg).
        # Python files (t/2926): matches assert_clean_data_tree calls with surgical_write=True.
        # Both allowlists are checked independently so a PS allowlist entry does not
        # accidentally exclude a Python file with the same basename.
        param(
            [Parameter(Mandatory)][string]$Root,
            [Parameter(Mandatory)][string[]]$Allowed,
            [string[]]$PyAllowed = @()
        )
        $rxPs  = '(?<![\w-])-Surg\w*'
        $rxPy  = 'surgical_write\s*=\s*True'
        $excl  = '[\\/](node_modules|\.git|\.worktrees|\.claude)[\\/]'
        @(
            # PowerShell: -SurgicalWrite / abbreviated -Surg forms
            Get-ChildItem -Path $Root -Recurse -Filter '*.ps1' -File -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -notmatch $excl } |
                Where-Object { $_.Name -notin $Allowed } |
                Where-Object { Select-String -Path $_.FullName -Pattern $rxPs -Quiet } |
                ForEach-Object { $_.FullName }
            # Python: assert_clean_data_tree(..., surgical_write=True) (t/2926)
            Get-ChildItem -Path $Root -Recurse -Filter '*.py' -File -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -notmatch $excl } |
                Where-Object { $_.Name -notin $PyAllowed } |
                Where-Object { Select-String -Path $_.FullName -Pattern $rxPy -Quiet } |
                ForEach-Object { $_.FullName }
        )
    }
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

    # Allowed to reference the exemption: the orchestrator (claims it), the sink (forwards
    # it), the guard (declares it), and THIS both-arms test (exercises it directly).
    # Python allowlist (t/2926): test_data_tree_guard.py exercises the Python surgical_write
    # parameter directly in both-arms tests; no other Python consumer is currently authorized.
    BeforeAll {
        $script:Allowed = @(
            'Save-JsonNodeFieldEdits.ps1'
            'Write-Utf8NoBom.ps1'
            'Assert-DataWriteAllowed.ps1'
            'SurgicalWriteExemption.Tests.ps1'
        )
        $script:PyAllowed = @(
            'data_tree_guard.py'        # declares the surgical_write parameter (analogous to Assert-DataWriteAllowed.ps1)
            'test_data_tree_guard.py'   # both-arms GV for the Python surgical_write exemption (t/2926)
        )
    }

    It 'CLEAN arm — repo-wide, only the allowlisted files reference the exemption (PS and Python)' {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
        Get-SurgicalExemptionViolations -Root $repoRoot -Allowed $script:Allowed -PyAllowed $script:PyAllowed |
            Should -BeNullOrEmpty -Because 'only Save-JsonNodeFieldEdits (PS) and test_data_tree_guard.py (Python GV) may claim the surgical exemption; a whole-file writer must not bypass the BLOCK tier'
    }

    It 'FIRE arm — the detector FLAGS a non-allowlisted PS writer that claims the exemption (via an abbreviated -Surg)' {
        # A detection gate never proven to fire is assumed, not verified (TL t/2916#10).
        # The rogue writer uses the ABBREVIATED form to also prove the grep catches it.
        $rogue = Join-Path $TestDrive 'Rogue-Writer.ps1'
        Set-Content -LiteralPath $rogue -Value 'Write-Utf8NoBom -Path $p -Value $x -Surg' -Encoding utf8
        $found = Get-SurgicalExemptionViolations -Root $TestDrive -Allowed $script:Allowed -PyAllowed $script:PyAllowed
        @($found).Count | Should -BeGreaterThan 0
        ($found -join ';')            | Should -Match 'Rogue-Writer'
    }

    It 'FIRE arm (Python) — the detector FLAGS a non-allowlisted Python writer that claims surgical_write=True (t/2926)' {
        # Proves the Python scanner fires; mirrors the PS FIRE arm (TL t/2916#10 bar).
        $rogue = Join-Path $TestDrive 'rogue_writer.py'
        Set-Content -LiteralPath $rogue -Value 'assert_clean_data_tree(path, surgical_write=True)' -Encoding utf8
        $found = Get-SurgicalExemptionViolations -Root $TestDrive -Allowed $script:Allowed -PyAllowed $script:PyAllowed
        @($found).Count | Should -BeGreaterThan 0
        ($found -join ';') | Should -Match 'rogue_writer'
    }

    It 'the "field-surgical" prose in a comment is NOT a false positive (lookbehind boundary)' {
        $benign = Join-Path $TestDrive 'Benign-Comment.ps1'
        Set-Content -LiteralPath $benign -Value '# performs a field-surgical, byte-surgical write; see byte-surgery notes' -Encoding utf8
        Get-SurgicalExemptionViolations -Root $TestDrive -Allowed $script:Allowed -PyAllowed $script:PyAllowed |
            Where-Object { $_ -match 'Benign-Comment' } |
            Should -BeNullOrEmpty
    }

    It 'surgical_write=False in a Python comment/declaration is NOT a false positive' {
        # The parameter declaration "surgical_write: bool = False" in data_tree_guard.py
        # must not trigger the scanner — only "surgical_write=True" (the call site) is flagged.
        $benign = Join-Path $TestDrive 'benign_decl.py'
        Set-Content -LiteralPath $benign -Value 'def assert_clean_data_tree(path, force=False, surgical_write=False): pass' -Encoding utf8
        Get-SurgicalExemptionViolations -Root $TestDrive -Allowed $script:Allowed -PyAllowed $script:PyAllowed |
            Where-Object { $_ -match 'benign_decl' } |
            Should -BeNullOrEmpty
    }
}
