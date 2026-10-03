# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
    Both arms for the remediation-hint split in check-shared-drift.ps1.
    Found live 2026-10-03: a DIVERGED (ahead=2, behind=2), no-real-WIP shared tree is correctly
    SyncBlocked=$false (no owner-claim), but the hint still recommended
    `git merge --ff-only origin/main` — which cannot succeed on a diverged tree and contradicts
    the hint's own SyncReason ("DevOps reset-sync path"). The remedy for that state is the
    reset-sync of docs/shared-tree-divergence.md, never ff.
    Real repos (bare origin + two clones), real script — no reimplementation.
#>

Describe 'check-shared-drift — diverged vs behind-only remediation hint' -Tag 'devops' {

    BeforeAll {
        $script:Script = "$PSScriptRoot/../operations/devops/check-shared-drift.ps1"

        function script:New-Topology {
            # origin (bare) + 'shared' (the checkout under test) + 'peer' (pushes to origin)
            $root = Join-Path ([System.IO.Path]::GetTempPath()) ("drift-hint-" + [guid]::NewGuid().ToString('N').Substring(0,8))
            New-Item -ItemType Directory -Path $root -Force | Out-Null
            $origin = Join-Path $root 'origin.git'; $shared = Join-Path $root 'shared'; $peer = Join-Path $root 'peer'
            git init -q --bare --initial-branch=main $origin 2>$null
            git clone -q $origin $shared 2>$null
            foreach ($r in @($shared)) {
                git -C $r config user.email t@t; git -C $r config user.name t; git -C $r config commit.gpgsign false
            }
            'seed' | Out-File -FilePath (Join-Path $shared 'seed.txt') -Encoding utf8
            git -C $shared add seed.txt 2>$null; git -C $shared commit -qm seed 2>$null
            git -C $shared push -q origin main 2>$null
            git clone -q $origin $peer 2>$null
            git -C $peer config user.email p@p; git -C $peer config user.name p; git -C $peer config commit.gpgsign false
            return [PSCustomObject]@{ Root = $root; Shared = $shared; Peer = $peer }
        }

        function script:Push-PeerCommit([string]$Peer, [string]$Name) {
            $Name | Out-File -FilePath (Join-Path $Peer "$Name.txt") -Encoding utf8
            git -C $Peer add "$Name.txt" 2>$null; git -C $Peer commit -qm $Name 2>$null
            git -C $Peer push -q origin main 2>$null
        }
    }

    Context 'Arm A — DIVERGED, no real WIP (the live 2026-10-03 state)' {
        It 'recommends the reset-sync, NOT merge --ff-only' {
            $t = script:New-Topology
            try {
                # local-only commit on the shared checkout (never pushed) ...
                'local' | Out-File -FilePath (Join-Path $t.Shared 'local.txt') -Encoding utf8
                git -C $t.Shared add local.txt 2>$null; git -C $t.Shared commit -qm local 2>$null
                # ... while origin moves on
                script:Push-PeerCommit $t.Peer 'remote1'
                git -C $t.Shared fetch -q origin 2>$null

                $r = & $script:Script -RepoRoot $t.Shared
                $r.AheadCount  | Should -BeGreaterThan 0
                $r.BehindCount | Should -BeGreaterThan 0
                $r.SyncBlocked | Should -BeFalse -Because 'no real WIP → no owner-claim'
                $r.RemediationHint | Should -Match 'DIVERGED .*ff is IMPOSSIBLE'
                $r.RemediationHint | Should -Match 'reset --hard origin/main'
                $r.RemediationHint | Should -Not -Match 'ff-sync is SAFE' -Because 'pre-fix code recommended ff-only here'
            } finally {
                Remove-Item -LiteralPath $t.Root -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Arm B — behind-only (0 ahead): ff stays the correct, gentler remedy' {
        It 'still recommends ff-only and does NOT suggest a reset' {
            $t = script:New-Topology
            try {
                script:Push-PeerCommit $t.Peer 'remote1'
                git -C $t.Shared fetch -q origin 2>$null

                $r = & $script:Script -RepoRoot $t.Shared
                $r.AheadCount  | Should -Be 0
                $r.BehindCount | Should -BeGreaterThan 0
                $r.RemediationHint | Should -Match 'ff-sync is SAFE'
                $r.RemediationHint | Should -Not -Match 'reset --hard' -Because 'reset is strictly more destructive than ff for a 0-ahead tree'
            } finally {
                Remove-Item -LiteralPath $t.Root -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
