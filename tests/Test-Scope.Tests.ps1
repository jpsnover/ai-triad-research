# Tag: powershell (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $script:ScopeScript = (Resolve-Path (Join-Path $PSScriptRoot '..' 'scripts' 'Test-Scope.ps1')).Path

    # Helper: invoke the script with a canned file list via -Files.
    # Suppress Write-Host (stream 6) so we capture only the structured PSObject.
    function script:Invoke-ScopeScript {
        param([string[]]$Files = @())
        if ($Files.Count -eq 0) {
            & $script:ScopeScript -Files @() 6>$null
        } else {
            & $script:ScopeScript -Files $Files 6>$null
        }
    }
}

Describe 'Test-Scope.ps1 — scope detection' -Tag 'powershell' {

    It 'Categorizes electron-only changes correctly' {
        $r = Invoke-ScopeScript -Files @('taxonomy-editor/src/renderer/App.tsx')
        $r | Should -Not -BeNullOrEmpty
        @($r.Scopes.electron).Count   | Should -Be 1
        @($r.Scopes.powershell).Count | Should -Be 0
        @($r.Scopes.lib).Count        | Should -Be 0
        $r.Recommendations | Should -Contain 'cd taxonomy-editor && npm run test:changed'
        @($r.Recommendations).Count | Should -Be 1
    }

    It 'Categorizes powershell-only changes with single subsystem → tag-scoped Pester' {
        $r = Invoke-ScopeScript -Files @('scripts/AITriad/Public/Get-Edge.ps1')
        $r.PsTag | Should -Be 'taxonomy'
        $r.Recommendations | Should -Contain 'Invoke-Pester ./tests/ -Tag taxonomy'
        @($r.Recommendations).Count | Should -Be 1
    }

    It 'Falls back to full Pester suite when powershell changes span multiple subsystems' {
        $r = Invoke-ScopeScript -Files @(
            'scripts/AITriad/Public/Get-Edge.ps1',          # taxonomy
            'scripts/AITriad/Public/Invoke-AITDebate.ps1'   # debate
        )
        $r.PsTag | Should -BeNullOrEmpty
        $r.Recommendations | Should -Contain 'Invoke-Pester ./tests/'
    }

    It 'lib changes trigger BOTH TS and full PS suites (cross-cutting)' {
        $r = Invoke-ScopeScript -Files @('lib/debate/debateEngine.ts')
        @($r.Scopes.lib).Count | Should -Be 1
        $r.Recommendations | Should -Contain 'cd taxonomy-editor && npm run test:changed'
        $r.Recommendations | Should -Contain 'Invoke-Pester ./tests/'
    }

    It 'CI-only changes recommend no tests' {
        $r = Invoke-ScopeScript -Files @('.github/workflows/ci.yml')
        @($r.Scopes.ci).Count | Should -Be 1
        (@($r.Recommendations) -join "`n") | Should -Match 'no tests needed'
    }

    It 'Mixed electron + powershell recommends both, in order' {
        $r = Invoke-ScopeScript -Files @(
            'taxonomy-editor/src/server/server.ts',
            'scripts/AITriad/Public/Get-Edge.ps1'
        )
        @($r.Recommendations)[0] | Should -Be 'cd taxonomy-editor && npm run test:changed'
        @($r.Recommendations)[1] | Should -Match 'Invoke-Pester'
    }

    It 'Classifies tests/*.Tests.ps1 as powershell scope' {
        $r = Invoke-ScopeScript -Files @('tests/Get-Edge.Tests.ps1')
        @($r.Scopes.powershell).Count | Should -Be 1
        @($r.Scopes.other).Count      | Should -Be 0
    }

    It 'Deduplicates files when the same path appears twice' {
        $r = Invoke-ScopeScript -Files @(
            'scripts/AITriad/Public/Get-Edge.ps1',
            'scripts/AITriad/Public/Get-Edge.ps1'
        )
        @($r.ChangedFiles).Count | Should -Be 1
    }

    It 'Clean working tree gives a "nothing to test" recommendation' {
        $r = Invoke-ScopeScript -Files @()
        @($r.ChangedFiles).Count | Should -Be 0
        (@($r.Recommendations) -join "`n") | Should -Match 'clean|no tests'
    }

    It 'Other-only changes (e.g. AGENTS.md, docs) recommend no tests' {
        $r = Invoke-ScopeScript -Files @('docs/error-handling.md')
        @($r.Scopes.other).Count | Should -Be 1
        (@($r.Recommendations) -join "`n") | Should -Match 'no tests|no code'
    }
}
