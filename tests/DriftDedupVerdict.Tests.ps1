# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Both-arms + fail-safe proof for the t/3801 dedup predicates. The load-bearing property (TL
# t/3801#2/#5): the fingerprint must change when a file's CONTENT STATE flips, even if the
# reason category and the path set are otherwise unchanged -- a reason-only or path-only key
# would suppress exactly the case that matters ("WIP swapped for something dangerous").

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'DriftDedupVerdict.ps1')
}

Describe 'Get-DriftReasonCategory' {
    It 'returns diverged when ahead>0 and behind>0' {
        Get-DriftReasonCategory -Behind 3 -Ahead 2 | Should -Be 'diverged'
    }
    It 'returns dirty-real-wip when real WIP exists (takes priority over phantom/behind)' {
        Get-DriftReasonCategory -Behind 2 -RealWipFiles @('a.ts') -PhantomFiles @('b.md') | Should -Be 'dirty-real-wip'
    }
    It 'returns dirty-redundant when only phantom files exist' {
        Get-DriftReasonCategory -Behind 0 -PhantomFiles @('docs/x.md') | Should -Be 'dirty-redundant'
    }
    It 'returns behind-only when behind>0 with no dirty files' {
        Get-DriftReasonCategory -Behind 5 | Should -Be 'behind-only'
    }
    It 'returns junk-or-branch when only junk/suspicious/stranded signals are present' {
        Get-DriftReasonCategory -JunkPaths @('x') | Should -Be 'junk-or-branch'
        Get-DriftReasonCategory -StrandedBranchesStatus 'SKIPPED-NO-NETWORK' | Should -Be 'junk-or-branch'
    }
    It 'returns none when nothing alarms' {
        Get-DriftReasonCategory | Should -Be 'none'
    }
}

Describe 'Get-DriftFingerprint' {
    It 'is deterministic: identical input produces identical output' {
        $states = @([PSCustomObject]@{ Path = 'a.md'; State = 'phantom' })
        $f1 = Get-DriftFingerprint -ReasonCategory 'dirty-redundant' -DirtyFileStates $states
        $f2 = Get-DriftFingerprint -ReasonCategory 'dirty-redundant' -DirtyFileStates $states
        $f1 | Should -Be $f2
    }

    It 'is REORDER-INVARIANT: the same set in a different order produces the SAME fingerprint' {
        $a = @([PSCustomObject]@{ Path = 'a.md'; State = 'phantom' }, [PSCustomObject]@{ Path = 'b.ps1'; State = 'real-wip' })
        $b = @([PSCustomObject]@{ Path = 'b.ps1'; State = 'real-wip' }, [PSCustomObject]@{ Path = 'a.md'; State = 'phantom' })
        $f1 = Get-DriftFingerprint -ReasonCategory 'dirty-real-wip' -DirtyFileStates $a -JunkPaths @('z', 'y')
        $f2 = Get-DriftFingerprint -ReasonCategory 'dirty-real-wip' -DirtyFileStates $b -JunkPaths @('y', 'z')
        $f1 | Should -Be $f2
    }

    It 'LOAD-BEARING: changes when a file is ADDED to the dirty set' {
        $before = @([PSCustomObject]@{ Path = 'a.md'; State = 'phantom' })
        $after  = @([PSCustomObject]@{ Path = 'a.md'; State = 'phantom' }, [PSCustomObject]@{ Path = 'c.ps1'; State = 'real-wip' })
        $f1 = Get-DriftFingerprint -ReasonCategory 'dirty-real-wip' -DirtyFileStates $before
        $f2 = Get-DriftFingerprint -ReasonCategory 'dirty-real-wip' -DirtyFileStates $after
        $f1 | Should -Not -Be $f2
    }

    It 'LOAD-BEARING (TL''s exact failure case): changes when a file''s CLASSIFICATION flips (redundant -> real-WIP), reason category and path identical' {
        # "WIP swapped for something dangerous" -- same file path, same coarse category label
        # possibility (both could be reported under a generic "dirty" umbrella), but the
        # per-file state differs. A reason-string-only or path-only key would NOT catch this.
        $phantomState = @([PSCustomObject]@{ Path = 'Build-NodeSourceIndex.ps1'; State = 'phantom' })
        $realWipState = @([PSCustomObject]@{ Path = 'Build-NodeSourceIndex.ps1'; State = 'real-wip' })
        $f1 = Get-DriftFingerprint -ReasonCategory 'dirty-redundant' -DirtyFileStates $phantomState
        $f2 = Get-DriftFingerprint -ReasonCategory 'dirty-real-wip' -DirtyFileStates $realWipState
        $f1 | Should -Not -Be $f2
    }

    It 'changes when a junk path is added' {
        $f1 = Get-DriftFingerprint -ReasonCategory 'junk-or-branch' -JunkPaths @('a')
        $f2 = Get-DriftFingerprint -ReasonCategory 'junk-or-branch' -JunkPaths @('a', 'b')
        $f1 | Should -Not -Be $f2
    }

    It 'changes when StrandedBranchesStatus changes (degraded vs OK) even with identical paths' {
        $f1 = Get-DriftFingerprint -ReasonCategory 'junk-or-branch' -StrandedBranchesStatus 'OK'
        $f2 = Get-DriftFingerprint -ReasonCategory 'junk-or-branch' -StrandedBranchesStatus 'SKIPPED-NO-NETWORK'
        $f1 | Should -Not -Be $f2
    }

    It 'is a 64-char lowercase hex string' {
        $f = Get-DriftFingerprint -ReasonCategory 'behind-only'
        $f | Should -Match '^[0-9a-f]{64}$'
    }
}

Describe 'Get-ShouldPing' {
    It 'does NOT ping when Alarm is false, regardless of fingerprints' {
        Get-ShouldPing -Alarm $false -CurrentFingerprint 'abc' -StoredFingerprint 'xyz' | Should -BeFalse
    }

    It 'PINGS when the fingerprint CHANGED from the stored one' {
        Get-ShouldPing -Alarm $true -CurrentFingerprint 'new' -StoredFingerprint 'old' -StoredStateValid $true | Should -BeTrue
    }

    It 'SUPPRESSES when the fingerprint is IDENTICAL to the stored one' {
        Get-ShouldPing -Alarm $true -CurrentFingerprint 'same' -StoredFingerprint 'same' -StoredStateValid $true | Should -BeFalse
    }

    It 'PINGS when there is no stored fingerprint yet (nothing parked)' {
        Get-ShouldPing -Alarm $true -CurrentFingerprint 'abc' -StoredFingerprint '' -StoredStateValid $true | Should -BeTrue
        Get-ShouldPing -Alarm $true -CurrentFingerprint 'abc' -StoredFingerprint $null -StoredStateValid $true | Should -BeTrue
    }

    It 'FAIL-SAFE: PINGS when the stored state is missing/corrupt, even if fingerprints happen to match' {
        # The decisive arm (t/3738 fail-closed spirit): uncertainty about the stored state must
        # never be read as "safe to suppress", even if a stale/corrupt read happens to produce
        # an identical-looking string.
        Get-ShouldPing -Alarm $true -CurrentFingerprint 'same' -StoredFingerprint 'same' -StoredStateValid $false | Should -BeTrue
    }
}

Describe 'Get-DriftFingerprintComposite (t/3880)' {
    It 'is the exact preimage of Get-DriftFingerprint (hash unchanged by the split)' {
        $a = @{ ReasonCategory = 'diverged'; StrandedBranches = @('b2', 'b1'); SuspiciousPaths = @('x') }
        $composite = Get-DriftFingerprintComposite @a
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $expected = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($composite)) | ForEach-Object { $_.ToString('x2') })
        $sha.Dispose()
        Get-DriftFingerprint @a | Should -Be $expected
    }
    It 'names the input that changed, so telemetry can say WHY a parked condition re-pinged' {
        $before = Get-DriftFingerprintComposite -ReasonCategory 'diverged' -StrandedBranches @('b1')
        $after  = Get-DriftFingerprintComposite -ReasonCategory 'diverged' -StrandedBranches @('b1', 'b2')
        $changed = @(Compare-Object ($before -split "`n") ($after -split "`n") | ForEach-Object { $_.InputObject })
        $changed | Should -Contain 'stranded=[b1,b2]'
        @($changed | Where-Object { $_ -notlike 'stranded=*' }).Count | Should -Be 0
    }
    It 'has no behind-count input: a diverged tree that only falls further behind keeps its fingerprint' {
        # The original t/3880 hypothesis (BehindCount churn) is structurally impossible; pin it.
        (Get-Command Get-DriftFingerprint).Parameters.Keys | Should -Not -Contain 'Behind'
        (Get-Command Get-DriftFingerprint).Parameters.Keys | Should -Not -Contain 'BehindCount'
    }
}
