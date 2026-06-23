BeforeAll {
    $ptRoot = "$PSScriptRoot/../scripts/Project-Template"
    . "$ptRoot/Private/New-ActionableError.ps1"
    foreach ($f in (Get-ChildItem "$ptRoot/Public/*.ps1")) { . $f.FullName }
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
}

Describe 'New-ADR' {

    BeforeAll {
        $script:origRepoRoot = $script:RepoRoot
        $script:adrDir = Join-Path $TestDrive 'adr'
        New-Item -ItemType Directory -Path $script:adrDir -Force | Out-Null
    }

    AfterAll {
        $script:RepoRoot = $script:origRepoRoot
    }

    It 'creates an ADR file with correct numbering (001 when empty dir)' {
        $all = New-ADR -Title 'Use structured logging' -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $result.Number | Should -Be 1
        $result.FileName | Should -Match '^001-'
        Test-Path $result.Path | Should -Be $true
    }

    It 'auto-increments ADR number from existing files' {
        $all = New-ADR -Title 'Second decision' -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $result.Number | Should -Be 2
        $result.FileName | Should -Match '^002-'
    }

    It 'generates a slug from the title' {
        $all = New-ADR -Title 'Adopt Ring Buffer for Diagnostics' -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $result.FileName | Should -Match 'adopt-ring-buffer-for-diagnostics'
    }

    It 'handles empty slug gracefully (special chars only title)' {
        $all = New-ADR -Title '!!!' -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $result.FileName | Should -Match 'untitled'
    }

    It 'truncates long slugs to 60 chars' {
        $longTitle = 'This is a very long title that should be truncated because it exceeds sixty characters in slug form'
        $all = New-ADR -Title $longTitle -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $slug = $result.FileName -replace '^\d{3}-', '' -replace '\.md$', ''
        $slug.Length | Should -BeLessOrEqual 60
    }

    It 'writes correct content with status, date, and author' {
        $all = New-ADR -Title 'Content check' -ADRDir $script:adrDir -NoOpen -Author 'Jane Doe' -Status 'accepted'
        $result = @($all)[-1]
        $content = Get-Content $result.Path -Raw
        $content | Should -Match 'ADR-\d+: Content check'
        $content | Should -Match '\*\*Status:\*\* accepted'
        $content | Should -Match '\*\*Author:\*\* Jane Doe'
        $content | Should -Match '\*\*Date:\*\*'
        $content | Should -Match '## Context'
        $content | Should -Match '## Decision'
        $content | Should -Match '## Consequences'
    }

    It 'defaults status to proposed' {
        $all = New-ADR -Title 'Default status' -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $result.Status | Should -Be 'proposed'
    }

    It 'throws when ADR directory does not exist' {
        { New-ADR -Title 'Fail' -ADRDir (Join-Path $TestDrive 'nonexistent-adr') -NoOpen } | Should -Throw
    }

    It 'returns structured output with all expected fields' {
        $all = New-ADR -Title 'Fields check' -ADRDir $script:adrDir -NoOpen -Author 'Test'
        $result = @($all)[-1]
        $result.PSObject.Properties['Number'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['Title'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['Status'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['Author'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['Date'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['FileName'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['Path'] | Should -Not -BeNullOrEmpty
    }
}

Describe 'Get-ADRIndex' {

    BeforeAll {
        $script:origRepoRoot = $script:RepoRoot
        $script:adrDir = Join-Path $TestDrive 'adr-index'
        New-Item -ItemType Directory -Path $script:adrDir -Force | Out-Null

        # Create synthetic ADR files
        Set-Content -Path (Join-Path $script:adrDir '000-template.md') -Value '# Template' -Encoding utf8

        Set-Content -Path (Join-Path $script:adrDir '001-use-actionable-error.md') -Value @"
# ADR-001: Use ActionableError everywhere

**Status:** accepted
**Date:** 2026-01-15
**Author:** Jeff

## Context
We need consistent error handling.
"@ -Encoding utf8

        Set-Content -Path (Join-Path $script:adrDir '002-byok-keys.md') -Value @"
# ADR-002: BYOK key management

**Status:** accepted
**Date:** 2026-02-01
**Author:** Jane

## Context
No secrets in infra.
"@ -Encoding utf8

        Set-Content -Path (Join-Path $script:adrDir '003-deprecated-approach.md') -Value @"
# ADR-003: Old caching approach

**Status:** deprecated
**Date:** 2026-03-10
**Author:** Bob

## Context
This was replaced.
"@ -Encoding utf8

        Set-Content -Path (Join-Path $script:adrDir '004-proposed-idea.md') -Value @"
# ADR-004: New idea

**Status:** proposed
**Date:** 2026-04-01
**Author:** Alice

## Context
Under review.
"@ -Encoding utf8
    }

    AfterAll {
        $script:RepoRoot = $script:origRepoRoot
    }

    It 'returns all ADRs except the template' {
        $adrs = Get-ADRIndex -ADRDir $script:adrDir
        @($adrs).Count | Should -Be 4
    }

    It 'parses number, title, status, date, and author from files' {
        $adrs = Get-ADRIndex -ADRDir $script:adrDir
        $first = @($adrs)[0]
        $first.Number | Should -Be 1
        $first.Title | Should -Be 'Use ActionableError everywhere'
        $first.Status | Should -Be 'accepted'
        $first.Date | Should -Be '2026-01-15'
        $first.Author | Should -Be 'Jeff'
    }

    It 'sorts results by ADR number' {
        $adrs = Get-ADRIndex -ADRDir $script:adrDir
        $numbers = @($adrs) | ForEach-Object { $_.Number }
        $numbers[0] | Should -Be 1
        $numbers[1] | Should -Be 2
        $numbers[2] | Should -Be 3
        $numbers[3] | Should -Be 4
    }

    It 'filters by status when -Status is provided' {
        $accepted = Get-ADRIndex -ADRDir $script:adrDir -Status 'accepted'
        @($accepted).Count | Should -Be 2
        @($accepted)[0].Status | Should -Be 'accepted'
        @($accepted)[1].Status | Should -Be 'accepted'
    }

    It 'returns empty for nonexistent status' {
        $none = Get-ADRIndex -ADRDir $script:adrDir -Status 'superseded'
        @($none).Count | Should -Be 0
    }

    It 'warns and returns nothing for missing ADR directory' {
        $result = Get-ADRIndex -ADRDir (Join-Path $TestDrive 'no-such-dir') -WarningVariable warn
        $result | Should -BeNullOrEmpty
        @($warn).Count | Should -BeGreaterOrEqual 1
    }

    It 'falls back to slug-derived title when header is missing' {
        $noHeaderDir = Join-Path $TestDrive 'adr-noheader'
        New-Item -ItemType Directory -Path $noHeaderDir -Force | Out-Null
        Set-Content -Path (Join-Path $noHeaderDir '001-some-decision.md') -Value @"
**Status:** proposed
**Date:** 2026-05-01
"@ -Encoding utf8

        $adrs = Get-ADRIndex -ADRDir $noHeaderDir
        @($adrs).Count | Should -Be 1
        @($adrs)[0].Title | Should -Be 'some decision'
    }

    It 'returns FileName and Path for each entry' {
        $adrs = Get-ADRIndex -ADRDir $script:adrDir
        $first = @($adrs)[0]
        $first.FileName | Should -Be '001-use-actionable-error.md'
        $first.Path | Should -Not -BeNullOrEmpty
        Test-Path $first.Path | Should -Be $true
    }
}
