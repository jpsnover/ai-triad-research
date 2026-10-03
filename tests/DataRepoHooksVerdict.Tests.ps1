# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3869 — every state of the data-repo hooks verdict, on SYNTHETIC facts. CI-safe by construction:
# nothing here reads a live data repo (CI's fresh data checkout never has core.hooksPath, so a live
# assertion in tests/ would be permanently red — t/3869#2). The live check runs only in verify:config.

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'DataRepoHooksVerdict.ps1')
    $script:Data = 'C:/x/ai-triad-data'
    $script:Ok   = [PSCustomObject]@{ Path = $script:Data; Source = 'config'; Undetermined = $false; Reason = '' }
    # Rooted on ANY OS (CI runs Linux, where Join-Path rejects a 'C:' drive). Only the tests that
    # reach Join-Path need a real rooted base; pure string-passthrough fixtures can stay literal.
    $script:Base = Join-Path ([System.IO.Path]::GetTempPath()) 't3869-code'
    $script:Code = Join-Path $script:Base 'ai-triad-research'
    $script:Want = [System.IO.Path]::GetFullPath((Join-Path $script:Base 'ai-triad-data'))
    $script:Exec = @{ 'pre-commit' = @{ Present = $true; CommittedMode = '100755'; IndexMode = '100755' } }
}

Describe 'Resolve-DataRepoRoot — same priority as the runtime (env > .aitriad.json > undetermined)' {
    It 'env var wins over .aitriad.json' {
        $r = Resolve-DataRepoRoot -EnvValue 'D:/elsewhere' -ConfigText '{"data_root":"../ai-triad-data"}' -ConfigDir 'C:/code'
        $r.Source | Should -Be 'env'
        $r.Path   | Should -Be 'D:/elsewhere'
    }
    It 'relative data_root is anchored at the config dir and normalized (no embedded ..)' {
        $r = Resolve-DataRepoRoot -EnvValue '' -ConfigText '{"data_root":"../ai-triad-data"}' -ConfigDir $script:Code
        $r.Undetermined | Should -BeFalse
        $r.Path | Should -Be $script:Want
        $r.Path | Should -Not -Match '\.\.'
    }
    It 'relative data_root anchors at AnchorRoot (main-checkout root) when given — the nested-worktree fix (#2732)' {
        # From a nested worktree, ConfigDir is <main>/.worktrees/x; anchoring there gives
        # <main>/.worktrees/ai-triad-data (nonexistent). The main root gives the real sibling.
        $r = Resolve-DataRepoRoot -EnvValue $null -ConfigText '{"data_root":"../ai-triad-data"}' `
            -ConfigDir (Join-Path (Join-Path $script:Code '.worktrees') 'x') -AnchorRoot $script:Code
        $r.Path | Should -Be $script:Want
    }
    It 'falls back to ConfigDir when AnchorRoot is unresolvable (non-git install) — same as the runtime' {
        $r = Resolve-DataRepoRoot -EnvValue $null -ConfigText '{"data_root":"../ai-triad-data"}' -ConfigDir $script:Code -AnchorRoot $null
        $r.Path | Should -Be $script:Want
    }
    It 'missing .aitriad.json is UNDETERMINED (runtime would silently fall back to the CODE repo)' {
        (Resolve-DataRepoRoot -EnvValue $null -ConfigText $null -ConfigDir 'C:/code').Undetermined | Should -BeTrue
    }
    It 'malformed .aitriad.json is UNDETERMINED' {
        (Resolve-DataRepoRoot -EnvValue $null -ConfigText '{not json' -ConfigDir 'C:/code').Undetermined | Should -BeTrue
    }
    It '.aitriad.json without data_root is UNDETERMINED' {
        (Resolve-DataRepoRoot -EnvValue $null -ConfigText '{"taxonomy_dir":"x"}' -ConfigDir 'C:/code').Undetermined | Should -BeTrue
    }
}

Describe 'Get-DataRepoHooksVerdict — every state, both arms' {
    It 'WIRED → PASS (relative .githooks, hook present + 100755)' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' -Hooks $script:Exec
        $v.State | Should -Be 'WIRED'; $v.Severity | Should -Be 'PASS'
    }
    It 'WIRED also accepts ./.githooks and the absolute <data>/.githooks form' {
        foreach ($hp in @('./.githooks', 'C:/x/ai-triad-data/.githooks', 'C:\x\ai-triad-data\.githooks\')) {
            (Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath $hp -Hooks $script:Exec).State |
                Should -Be 'WIRED' -Because "hooksPath '$hp' points at the data repo's .githooks"
        }
    }
    It 'UNWIRED (hooksPath unset) → WARN, not FAIL (warn-first, Gate Promotion)' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath $null -Hooks $script:Exec
        $v.State | Should -Be 'UNWIRED'; $v.Severity | Should -Be 'WARN'
        $v.Remediation | Should -Match 'core.hooksPath .githooks'
    }
    It 'MISWIRED (hooksPath points elsewhere) → WARN — a wrong path is as unenforced as an unset one' {
        foreach ($hp in @('.git/hooks', 'C:/other/.githooks', 'hooks')) {
            $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath $hp -Hooks $script:Exec
            $v.State | Should -Be 'MISWIRED' -Because "hooksPath '$hp' is not the data repo's .githooks"
            $v.Severity | Should -Be 'WARN'
        }
    }
    It 'HOOK_MISSING when an expected hook is absent → WARN' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $false; CommittedMode = $null; IndexMode = $null } }
        $v.State | Should -Be 'HOOK_MISSING'; $v.Reason | Should -Match 'pre-commit absent'
    }
    It 'HOOK_MISSING when a hook is present but NOT executable as committed (HEAD 100644 — git ignores it on Linux/macOS)' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $true; CommittedMode = '100644'; IndexMode = '100644' } }
        $v.State | Should -Be 'HOOK_MISSING'; $v.Reason | Should -Match 'not executable as committed'
        # remediation points at the tested recipe, and says how to VERIFY the committed mode
        $v.Remediation | Should -Match 't/3851#9'
        $v.Remediation | Should -Match 'ls-tree HEAD'
    }
    It 'HOOK_MISSING (not WIRED) when +x is STAGED but never committed — index 100755, HEAD 100644 (TL p/331#1811)' {
        # The shape a pathspec commit leaves under core.fileMode=false. An INDEX-based read would
        # report WIRED here — a false green. The committed mode must decide.
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $true; CommittedMode = '100644'; IndexMode = '100755' } }
        $v.State  | Should -Be 'HOOK_MISSING' -Because 'what clones receive is the committed mode'
        $v.Reason | Should -Match 'STAGED but was never committed'
    }
    It 'COMMITTED_NOT_PUSHED when HEAD is 100755 but origin still has 100644 (TL p/331#1813)' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $true; CommittedMode = '100755'; IndexMode = '100755'; RemoteRef = 'origin/main'; RemoteMode = '100644' } }
        $v.State    | Should -Be 'COMMITTED_NOT_PUSHED' -Because 'a fresh Linux/macOS clone gets origin, not local HEAD'
        $v.Severity | Should -Be 'WARN'
        $v.Reason   | Should -Match 'as of last fetch'
    }
    It 'COMMITTED_NOT_PUSHED when the hook exists in HEAD but is absent on origin' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'commit-msg' = @{ Present = $true; CommittedMode = '100755'; IndexMode = '100755'; RemoteRef = 'origin/main'; RemoteMode = $null } }
        $v.State  | Should -Be 'COMMITTED_NOT_PUSHED'
        $v.Reason | Should -Match 'absent on origin/main'
    }
    It 'WIRED (with origin match noted) when HEAD and origin are both 100755' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $true; CommittedMode = '100755'; IndexMode = '100755'; RemoteRef = 'origin/main'; RemoteMode = '100755' } }
        $v.State  | Should -Be 'WIRED'
        $v.Reason | Should -Match 'matches origin/main'
    }
    It 'WIRED with no origin ref says so explicitly — not a silent pass on the clone-facing mode' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' -Hooks $script:Exec
        $v.State  | Should -Be 'WIRED'
        $v.Reason | Should -Match 'NOT checked'
    }
    It 'WIRED requires the COMMITTED mode — index 100755 alone is not enough, HEAD 100755 is' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $true; CommittedMode = '100755'; IndexMode = '100644' } }
        $v.State | Should -Be 'WIRED' -Because 'committed 100755 is what every clone gets; a dirty index does not change that'
    }
    It 'ABSENT (no data repo at a config-resolved path) → N/A, never PASS' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $false -IsGitRepo $false
        $v.State | Should -Be 'ABSENT'; $v.Severity | Should -Be 'NA'
        $v.Severity | Should -Not -Be 'PASS'
    }
    It 'UNDETERMINED when an EXPLICIT env var points at a nonexistent path → FAIL (broken config, not code-only)' {
        $envRes = [PSCustomObject]@{ Path = 'D:/nope'; Source = 'env'; Undetermined = $false; Reason = '' }
        $v = Get-DataRepoHooksVerdict -Resolution $envRes -PathExists $false -IsGitRepo $false
        $v.State | Should -Be 'UNDETERMINED'; $v.Severity | Should -Be 'FAIL'
    }
    It 'UNDETERMINED when the path exists but is not a git repo → FAIL' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $false
        $v.State | Should -Be 'UNDETERMINED'; $v.Severity | Should -Be 'FAIL'
    }
    It 'UNDETERMINED when resolution itself failed (malformed .aitriad.json) → FAIL' {
        $bad = Resolve-DataRepoRoot -EnvValue $null -ConfigText '{not json' -ConfigDir 'C:/code'
        (Get-DataRepoHooksVerdict -Resolution $bad).Severity | Should -Be 'FAIL'
    }
}
