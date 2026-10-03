# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3869 — every state of the data-repo hooks verdict, on SYNTHETIC facts. CI-safe by construction:
# nothing here reads a live data repo (CI's fresh data checkout never has core.hooksPath, so a live
# assertion in tests/ would be permanently red — t/3869#2). The live check runs only in verify:config.

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'DataRepoHooksVerdict.ps1')
    $script:Data = 'C:/x/ai-triad-data'
    $script:Ok   = [PSCustomObject]@{ Path = $script:Data; Source = 'config'; Undetermined = $false; Reason = '' }
    $script:Exec = @{ 'pre-commit' = @{ Present = $true; IndexMode = '100755' } }
}

Describe 'Resolve-DataRepoRoot — same priority as the runtime (env > .aitriad.json > undetermined)' {
    It 'env var wins over .aitriad.json' {
        $r = Resolve-DataRepoRoot -EnvValue 'D:/elsewhere' -ConfigText '{"data_root":"../ai-triad-data"}' -ConfigDir 'C:/code'
        $r.Source | Should -Be 'env'
        $r.Path   | Should -Be 'D:/elsewhere'
    }
    It 'relative data_root is anchored at the config dir and normalized (no embedded ..)' {
        $r = Resolve-DataRepoRoot -EnvValue '' -ConfigText '{"data_root":"../ai-triad-data"}' -ConfigDir 'C:/code/ai-triad-research'
        $r.Undetermined | Should -BeFalse
        $r.Path | Should -Be ([System.IO.Path]::GetFullPath('C:/code/ai-triad-data'))
        $r.Path | Should -Not -Match '\.\.'
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
            -Hooks @{ 'pre-commit' = @{ Present = $false; IndexMode = $null } }
        $v.State | Should -Be 'HOOK_MISSING'; $v.Reason | Should -Match 'pre-commit absent'
    }
    It 'HOOK_MISSING when a hook is present but NOT executable (index 100644 — git ignores it on Linux/macOS)' {
        $v = Get-DataRepoHooksVerdict -Resolution $script:Ok -PathExists $true -IsGitRepo $true -HooksPath '.githooks' `
            -Hooks @{ 'pre-commit' = @{ Present = $true; IndexMode = '100644' } }
        $v.State | Should -Be 'HOOK_MISSING'; $v.Reason | Should -Match 'not executable'
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
