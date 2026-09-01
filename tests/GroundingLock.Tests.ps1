# Tag: unit (t/3203)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/3203: the entity_mentions grounding write-lock (Enter/Exit-GroundingLock) — advisory,
    exclusive-create acquire, mtime-staleness break (>120s), bounded wait → ActionableError,
    and Update-EntityMentionIndex acquires/releases it around its read-merge-write. Mirrors the
    Python reconcile_grounding.py contract (t/3194).
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Enter/Exit-GroundingLock (t/3203)' -Tag 'unit' {

    It 'acquires an unheld lock (creates the file, returns a handle) and releases it' {
        InModuleScope AITriad {
            $lock = Join-Path $TestDrive ([guid]::NewGuid().ToString('N')) 'entity_mentions.lock'
            New-Item -ItemType Directory -Path (Split-Path $lock) -Force | Out-Null

            $h = Enter-GroundingLock -LockPath $lock
            try {
                Test-Path -LiteralPath $lock | Should -BeTrue
                $h | Should -BeOfType [System.IO.FileStream]
            }
            finally {
                Exit-GroundingLock -Handle $h -LockPath $lock
            }
            # released — file gone
            Test-Path -LiteralPath $lock | Should -BeFalse
        }
    }

    It 'times out with an ActionableError when the lock is held (fresh) and not stale' {
        InModuleScope AITriad {
            $lock = Join-Path $TestDrive ([guid]::NewGuid().ToString('N')) 'entity_mentions.lock'
            New-Item -ItemType Directory -Path (Split-Path $lock) -Force | Out-Null
            New-Item -ItemType File -Path $lock -Force | Out-Null   # held (mtime = now)

            # WaitSec 1, StaleSec 120 → not stale, so it waits ~1s then throws.
            { Enter-GroundingLock -LockPath $lock -WaitSec 1 -StaleSec 120 -PollSec 0.2 } |
                Should -Throw '*held by another writer*'
        }
    }

    It 'breaks a stale lock (mtime age > StaleSec), WARNs, and acquires' {
        InModuleScope AITriad {
            $lock = Join-Path $TestDrive ([guid]::NewGuid().ToString('N')) 'entity_mentions.lock'
            New-Item -ItemType Directory -Path (Split-Path $lock) -Force | Out-Null
            New-Item -ItemType File -Path $lock -Force | Out-Null
            # Age the holder past the staleness threshold.
            (Get-Item -LiteralPath $lock).LastWriteTime = (Get-Date).AddSeconds(-200)

            $warn = @()
            $h = Enter-GroundingLock -LockPath $lock -WaitSec 5 -StaleSec 120 -PollSec 0.2 -WarningVariable warn -WarningAction SilentlyContinue
            try {
                $h | Should -BeOfType [System.IO.FileStream]     # acquired after breaking the stale lock
                ($warn -join ' ') | Should -Match 'stale lock'
            }
            finally {
                Exit-GroundingLock -Handle $h -LockPath $lock
            }
        }
    }
}

Describe 'Update-EntityMentionIndex honors the grounding lock (t/3203)' -Tag 'unit' {

    It 'acquires + releases the lock around the write (no leftover entity_mentions.lock)' {
        $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $entPath = Join-Path $root 'entities.json'
        $outPath = Join-Path $root 'entity_mentions.json'
        ([ordered]@{ _schema_version = '1.0.0'; _doc = 't'; entity_count = 1; last_modified = '2026-09-01'
                entities = @([ordered]@{ id = 'ent-001'; name = 'Apollo Project'; aliases = @(); entity_type = 'event'; status = 'approved' }) } |
            ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $entPath -Encoding utf8NoBOM
        ([ordered]@{ 'acc-desires-001' = @{ facts = @(@{ claim = 'The Apollo Project reshaped ambition.' }) } } |
            ConvertTo-Json -Depth 8) | Set-Content -LiteralPath (Join-Path $root 'sei.json') -Encoding utf8NoBOM

        $r = Update-EntityMentionIndex -EntitiesPath $entPath `
            -SourceEvidenceIndexPath (Join-Path $root 'sei.json') -SummariesPath @() -OutputPath $outPath
        $r.Written | Should -BeTrue
        # The write happened AND the lock was released (no leftover lockfile beside the output).
        Test-Path -LiteralPath (Join-Path $root 'entity_mentions.lock') | Should -BeFalse
    }
}
