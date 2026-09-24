# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Both-arms for the t/3634 shell-fragment detection in check-shared-drift.ps1.
.DESCRIPTION
    The pre-fix check silently MISSED 0-byte untracked files whose names carry shell
    metacharacters (`[` `]` backtick `{` `}` …): the non-`-LiteralPath` Get-Item parsed the
    name as a PowerShell wildcard, errored, and the file was skipped — never classified,
    never auto-removed. That is exactly the t/2112 word-split junk this ticket targets.

    CRITICAL (TL condition, p/331#1279): the Arm-A fixture name MUST contain the characters
    that broke the OLD path-match (backtick + braces + brackets) — a plain 0-byte file would
    have been caught by the old code too, so the test would pass pre-fix and prove nothing.

    Runs the REAL script against a temp git repo (isolated RepoRoot) so we exercise the whole
    enumerate→classify→auto-remove path, not a reimplementation.
#>

Describe 'check-shared-drift — shell-fragment 0-byte detection (t/3634)' -Tag 'devops' {

    BeforeAll {
        $script:Script = "$PSScriptRoot/../operations/devops/check-shared-drift.ps1"

        function script:New-TempRepo {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("drift-t3634-" + [guid]::NewGuid().ToString('N').Substring(0,8))
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Push-Location $dir
            try {
                git init -q 2>$null
                git config user.email t@t 2>$null; git config user.name t 2>$null
                git config commit.gpgsign false 2>$null
                'seed' | Out-File -FilePath (Join-Path $dir 'seed.txt') -Encoding utf8
                git add seed.txt 2>$null; git commit -qm seed 2>$null
            } finally { Pop-Location }
            return $dir
        }
    }

    Context 'Arm A — a metachar-named 0-byte fragment (the name that broke the old path-match)' {
        It 'is flagged in ShellFragmentPaths (and swept) — would be MISSED by pre-fix code' {
            $repo = script:New-TempRepo
            try {
                # Name carries backtick + braces + brackets — the exact chars the old non-literal
                # Get-Item treated as a (non-matching) wildcard and silently skipped.
                $frag = 'operations/devops/`0`].{name'
                New-Item -ItemType Directory -Path (Join-Path $repo 'operations/devops') -Force | Out-Null
                $fragFull = Join-Path $repo $frag
                New-Item -ItemType File -Path $fragFull -Force | Out-Null
                (Get-Item -LiteralPath $fragFull).Length | Should -Be 0

                $r = & $script:Script -RepoRoot $repo
                # Named finding present:
                ($r.ShellFragmentPaths -join '|') | Should -Match 'name'
                # Alarm raised (surfaced, not silent):
                $r.Alarm | Should -BeTrue
                # And it was swept:
                (Test-Path -LiteralPath $fragFull) | Should -BeFalse
            } finally {
                Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Arm B — a clean tree' {
        It 'reports empty ShellFragmentPaths and no alarm' {
            $repo = script:New-TempRepo
            try {
                $r = & $script:Script -RepoRoot $repo
                @($r.ShellFragmentPaths).Count | Should -Be 0
                $r.Alarm | Should -BeFalse
            } finally {
                Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Edge — a metachar-named NON-empty file is NOT a shell-fragment (only 0-byte)' {
        It 'does not list a non-empty metachar file in ShellFragmentPaths' {
            $repo = script:New-TempRepo
            try {
                $frag = 'operations/devops/`notempty`].{x'
                New-Item -ItemType Directory -Path (Join-Path $repo 'operations/devops') -Force | Out-Null
                $fragFull = Join-Path $repo $frag
                'real content' | Out-File -FilePath $fragFull -Encoding utf8
                $r = & $script:Script -RepoRoot $repo
                ($r.ShellFragmentPaths -join '|') | Should -Not -Match 'notempty'
            } finally {
                Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
