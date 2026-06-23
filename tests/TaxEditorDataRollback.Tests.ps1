# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-TaxEditorDataCommit' {

    It 'Throws when GITHUB_TOKEN is not set' {
        Mock Invoke-RestMethod -ModuleName AITriad
        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = $null
            { Get-TaxEditorDataCommit 2>$null } | Should -Throw
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Returns typed DataCommit objects' {
        $SampleCommits = @(
            @{
                sha    = 'abc1234567890abcdef1234567890abcdef123456'
                commit = @{
                    message = "Update accelerationist.json`nAdded new node"
                    author  = @{ name = 'jpsnover'; date = '2026-06-22T10:00:00Z' }
                }
                parents = @(@{ sha = 'parent111' })
                files   = @()
            }
            @{
                sha    = 'def5678901234567890abcdef1234567890abcdef'
                commit = @{
                    message = 'Fix safetyist description'
                    author  = @{ name = 'contributor'; date = '2026-06-21T08:00:00Z' }
                }
                parents = @(@{ sha = 'parent222' })
                files   = @()
            }
        )

        Mock Invoke-RestMethod { $SampleCommits } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            $results = @(Get-TaxEditorDataCommit -Last 2)
            $results.Count | Should -Be 2
            $results[0].ShortSha | Should -Be 'abc1234'
            $results[0].Message | Should -Be 'Update accelerationist.json'
            $results[0].Author | Should -Be 'jpsnover'
            $results[1].ShortSha | Should -Be 'def5678'
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Validates -Last range' {
        { Get-TaxEditorDataCommit -Last 0 } | Should -Throw
        { Get-TaxEditorDataCommit -Last 101 } | Should -Throw
    }
}

Describe 'Undo-TaxEditorDataCommit' {

    BeforeAll {
        $SampleCommit = @{
            sha     = 'abc1234567890abcdef1234567890abcdef123456'
            commit  = @{ message = 'Bad taxonomy change' }
            parents = @(@{ sha = 'parent111222333444555666777888999aabbccdd' })
            files   = @(
                @{ filename = 'accelerationist.json'; status = 'modified' }
            )
        }

        $HeadRef = @{ object = @{ sha = 'head999888777666555444333222111aabbccddee' } }

        $HeadCommit = @{
            sha  = 'head999888777666555444333222111aabbccddee'
            tree = @{ sha = 'tree-sha-head' }
        }

        $Comparison = @{ files = @() }

        $ParentContents = @{ sha = 'blob-sha-parent-version' }

        $NewTree = @{ sha = 'new-tree-sha' }

        $NewCommit = @{ sha = 'revert-commit-sha-1234567890' }
    }

    It 'Throws when GITHUB_TOKEN is not set' {
        Mock Invoke-RestMethod -ModuleName AITriad
        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = $null
            { Undo-TaxEditorDataCommit -Sha 'abc1234' -Confirm:$false 2>$null } | Should -Throw
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Throws on merge commits (multiple parents)' {
        $MergeCommit = @{
            sha     = 'merge123'
            commit  = @{ message = 'Merge PR' }
            parents = @(@{ sha = 'p1' }, @{ sha = 'p2' })
            files   = @(@{ filename = 'f.json'; status = 'modified' })
        }

        Mock Invoke-RestMethod { $MergeCommit } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            { Undo-TaxEditorDataCommit -Sha 'merge123' -Confirm:$false 2>$null } | Should -Throw
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Throws on conflicts with subsequent commits' {
        $ConflictComparison = @{
            files = @(@{ filename = 'accelerationist.json' })
        }

        $CallCount = 0
        Mock Invoke-RestMethod {
            $CallCount++
            switch ($CallCount) {
                1 { return $SampleCommit }
                2 { return $HeadRef }
                3 { return $ConflictComparison }
                default { return @{} }
            }
        } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            Set-Variable -Name CallCount -Value 0 -Scope 1
            { Undo-TaxEditorDataCommit -Sha 'abc1234' -Confirm:$false 2>$null } | Should -Throw
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'WhatIf shows action without executing revert' {
        Mock Invoke-RestMethod {
            if ($Uri -like '*/commits/*' -and $Uri -notlike '*/git/commits/*') { return $SampleCommit }
            if ($Uri -like '*/git/ref/heads/main') { return $HeadRef }
            if ($Uri -like '*/compare/*') { return $Comparison }
            return @{}
        } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            $result = Undo-TaxEditorDataCommit -Sha 'abc1234' -WhatIf
            $result | Should -BeNullOrEmpty
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Happy path: creates revert commit for modifications' {
        Mock Invoke-RestMethod {
            if ($Uri -like '*/commits/*' -and $Uri -notlike '*/git/commits/*') { return $SampleCommit }
            if ($Uri -like '*/git/ref/heads/main') { return $HeadRef }
            if ($Uri -like '*/compare/*') { return $Comparison }
            if ($Uri -like '*/git/commits/*' -and "$Method" -ne 'POST') { return $HeadCommit }
            if ($Uri -like '*/contents/*') { return $ParentContents }
            if ($Uri -like '*/git/trees*') { return $NewTree }
            if ($Uri -like '*/git/commits' -and "$Method" -eq 'POST') { return $NewCommit }
            if ("$Method" -eq 'PATCH') { return @{ object = @{ sha = $NewCommit.sha } } }
            return @{}
        } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            $result = Undo-TaxEditorDataCommit -Sha 'abc1234' -Confirm:$false
            $result.Action | Should -Be 'DataRevert'
            $result.RevertedMsg | Should -Be 'Bad taxonomy change'
            $result.NewSha | Should -Be 'revert-commit-sha-1234567890'
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }
}

Describe 'Sync-TaxEditorData' {

    It 'Returns sync result on success' {
        Mock Invoke-RestMethod {
            @{ ok = $true; message = 'Fetched latest from GitHub'; session_ahead = 0 }
        } -ModuleName AITriad

        $result = Sync-TaxEditorData -BaseUrl 'http://localhost:3001'
        $result.Action | Should -Be 'DataSync'
        $result.Mode | Should -Be 'fetch-only'
        $result.Ok | Should -BeTrue
    }

    It 'Throws with ActionableError on HTTP failure' {
        Mock Invoke-RestMethod { throw 'Connection refused' } -ModuleName AITriad

        { Sync-TaxEditorData -BaseUrl 'http://localhost:9999' 2>$null } | Should -Throw
    }

    It 'Accepts reset-main mode' {
        Mock Invoke-RestMethod {
            @{ ok = $true; message = 'Session reset to main' }
        } -ModuleName AITriad

        $result = Sync-TaxEditorData -BaseUrl 'http://localhost:3001' -Mode 'reset-main'
        $result.Mode | Should -Be 'reset-main'
    }
}

Describe 'Reset-TaxEditorSession' {

    BeforeAll {
        $BranchInfo = @{
            object = @{ sha = 'session-sha-1234567890abcdef12345678' }
        }
        $MainRef = @{
            object = @{ sha = 'main-sha-abcdef1234567890abcdef12' }
        }
    }

    It 'Throws when GITHUB_TOKEN is not set' {
        Mock Invoke-RestMethod -ModuleName AITriad
        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = $null
            { Reset-TaxEditorSession -UserId 'testuser' -Confirm:$false 2>$null } | Should -Throw
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Throws when session branch does not exist' {
        Mock Invoke-RestMethod { throw 'Not Found' } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            { Reset-TaxEditorSession -UserId 'nonexistent' -Confirm:$false 2>$null } | Should -Throw
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Returns unchanged when session already at main' {
        $SameSha = 'same-sha-everywhere-1234567890abcdef'
        $CallCount = 0
        Mock Invoke-RestMethod {
            $CallCount++
            switch ($CallCount) {
                1 { return @{ object = @{ sha = $SameSha } } }
                2 { return @{ object = @{ sha = $SameSha } } }
                default { return @{} }
            }
        } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            Set-Variable -Name CallCount -Value 0 -Scope 1
            $result = Reset-TaxEditorSession -UserId 'testuser' -Confirm:$false
            $result.Changed | Should -BeFalse
            $result.Action | Should -Be 'SessionReset'
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'WhatIf shows action without executing' {
        Mock Invoke-RestMethod {
            if ($Uri -like '*api-session*') { return $BranchInfo }
            if ($Uri -like '*/ref/heads/main') { return $MainRef }
            return @{}
        } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            $result = Reset-TaxEditorSession -UserId 'testuser' -WhatIf
            $result | Should -BeNullOrEmpty
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }

    It 'Happy path: force-resets session branch to main' {
        Mock Invoke-RestMethod {
            if ($Uri -like '*api-session*' -and "$Method" -ne 'PATCH') { return $BranchInfo }
            if ($Uri -like '*/ref/heads/main') { return $MainRef }
            if ("$Method" -eq 'PATCH') { return @{ object = @{ sha = $MainRef.object.sha } } }
            return @{}
        } -ModuleName AITriad

        $OrigToken = $env:GITHUB_TOKEN
        try {
            $env:GITHUB_TOKEN = 'test-token-placeholder'
            $result = Reset-TaxEditorSession -UserId 'testuser' -Confirm:$false
            $result.Action | Should -Be 'SessionReset'
            $result.UserId | Should -Be 'testuser'
            $result.Branch | Should -Be 'api-session/testuser'
            $result.Changed | Should -BeTrue
        }
        finally {
            $env:GITHUB_TOKEN = $OrigToken
        }
    }
}
