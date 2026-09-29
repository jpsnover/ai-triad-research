# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Both-arms + fail-closed proof for the drift-check hold predicate (t/3745, TL p/331#1666-1674).
# The fix: hold iff real WIP intersects the incoming change-set — NOT on any real WIP (HasRealDiff).

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'DriftSyncVerdict.ps1')
}

Describe 'Get-DriftSyncVerdict' {

    Context 'clean-behind (ahead=0) — the core intersection fix' {
        It 'HOLDS when a real-WIP file IS in the incoming change-set (ff would overwrite it)' {
            $v = Get-DriftSyncVerdict -RealWipFiles @('lib/foo.ts') -IncomingFiles @('lib/foo.ts', 'docs/x.md') -Behind 3 -Ahead 0
            $v.SyncBlocked | Should -BeTrue
            $v.Conflicts | Should -Be @('lib/foo.ts')
        }

        It 'does NOT hold when real WIP does NOT intersect the incoming set (WIP carried through)' {
            $v = Get-DriftSyncVerdict -RealWipFiles @('docs/LessonsLearned.md') -IncomingFiles @('lib/a.ts', 'lib/b.ts') -Behind 9 -Ahead 0
            $v.SyncBlocked | Should -BeFalse
            $v.Conflicts | Should -BeNullOrEmpty
        }

        It 'does NOT hold when there is no real WIP at all' {
            $v = Get-DriftSyncVerdict -RealWipFiles @() -IncomingFiles @('lib/a.ts') -Behind 2 -Ahead 0
            $v.SyncBlocked | Should -BeFalse
        }

        It 'reports ONLY the intersecting files as conflicts (not all WIP)' {
            $v = Get-DriftSyncVerdict -RealWipFiles @('a.ts', 'b.ts', 'c.ts') -IncomingFiles @('b.ts', 'z.ts') -Behind 4 -Ahead 0
            $v.SyncBlocked | Should -BeTrue
            $v.Conflicts | Should -Be @('b.ts')
        }
    }

    Context "today's regression fixture (the live case that motivated the fix)" {
        # LessonsLearned.md dirty (real WIP), 9 behind, none of the incoming commits touch it.
        # Old predicate (HasRealDiff) held for hours; correct predicate does not.
        It 'LessonsLearned dirty + 9-behind + non-intersecting incoming → NOT blocked' {
            $incoming = @('taxonomy-editor/src/a.tsx', 'lib/brief/x.json', 'scripts/AITriad/Public/Test-CitationLinkIntegrity.ps1') # 24 real files in reality; none is LessonsLearned
            $v = Get-DriftSyncVerdict -RealWipFiles @('docs/LessonsLearned.md') -IncomingFiles $incoming -Behind 9 -Ahead 0
            $v.SyncBlocked | Should -BeFalse
            $v.Reason | Should -Match 'does NOT intersect'
        }
    }

    Context 'diverged (ahead>0, behind>0) — reset --hard overwrites all, intersection carve-out does NOT apply' {
        It 'HOLDS on ANY real WIP regardless of intersection (reset destroys everything)' {
            # WIP does not intersect incoming, but diverged → reset --hard would still destroy it → hold.
            $v = Get-DriftSyncVerdict -RealWipFiles @('docs/notes.md') -IncomingFiles @('lib/a.ts') -Behind 5 -Ahead 2
            $v.SyncBlocked | Should -BeTrue
            $v.Reason | Should -Match 'DIVERGED'
        }

        It 'does NOT hold when diverged with no real WIP (DevOps reset-sync path)' {
            $v = Get-DriftSyncVerdict -RealWipFiles @() -IncomingFiles @('lib/a.ts') -Behind 5 -Ahead 2
            $v.SyncBlocked | Should -BeFalse
        }
    }

    Context 'current (behind=0) — nothing to sync' {
        It 'never blocks when behind=0, even with real WIP' {
            $v = Get-DriftSyncVerdict -RealWipFiles @('a.ts') -IncomingFiles @() -Behind 0 -Ahead 0
            $v.SyncBlocked | Should -BeFalse
        }
    }

    Context 'FAIL-CLOSED arms — empty/unknown inputs must never read as safe' {
        It 'behind>0 + IncomingKnown=$false (git diff failed) → BLOCKED (fail closed)' {
            $v = Get-DriftSyncVerdict -RealWipFiles @('a.ts') -IncomingFiles @() -Behind 3 -Ahead 0 -IncomingKnown $false
            $v.SyncBlocked | Should -BeTrue
            $v.Reason | Should -Match 'BROKEN'
        }

        It 'behind>0 + empty incoming set (impossible for a real behind) → BLOCKED (fail closed)' {
            $v = Get-DriftSyncVerdict -RealWipFiles @() -IncomingFiles @() -Behind 3 -Ahead 0
            $v.SyncBlocked | Should -BeTrue
            $v.Reason | Should -Match 'BROKEN'
        }

        It 'blocks fail-closed even with no WIP — the broken-state guard is independent of WIP' {
            $v = Get-DriftSyncVerdict -RealWipFiles @() -IncomingFiles @() -Behind 1 -Ahead 0 -IncomingKnown $false
            $v.SyncBlocked | Should -BeTrue
        }
    }

    Context 'untracked backstop (documented behavior — TL p/331#1674)' {
        It 'the verdict considers only tracked RealWipFiles; untracked collisions are gits ff-only backstop, not held here' {
            # An untracked file that would collide with an incoming add is NOT in RealWipFiles, so the
            # predicate does not block — git merge --ff-only refuses ("untracked would be overwritten"),
            # a failed sync attempt, not data loss. The verdict correctly does not see untracked input.
            $v = Get-DriftSyncVerdict -RealWipFiles @() -IncomingFiles @('newfile.ts') -Behind 2 -Ahead 0
            $v.SyncBlocked | Should -BeFalse
        }
    }
}
