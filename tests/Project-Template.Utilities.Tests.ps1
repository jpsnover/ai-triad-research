# Tag: template (t/1186)
BeforeAll {
    $ptRoot = "$PSScriptRoot/../scripts/Project-Template"
    . "$ptRoot/Private/New-ActionableError.ps1"
    foreach ($f in (Get-ChildItem "$ptRoot/Public/*.ps1")) { . $f.FullName }
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
}

Describe 'Get-ProjectMap' -Tag 'template' {

    BeforeAll {
        $script:origRepoRoot = $script:RepoRoot
        $script:fakeRoot = Join-Path $TestDrive 'map-repo'
        New-Item -ItemType Directory -Path $script:fakeRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:fakeRoot 'src') -Force | Out-Null
        Set-Content -Path (Join-Path $script:fakeRoot 'CLAUDE.md') -Value '# Instructions' -Encoding utf8
        Set-Content -Path (Join-Path $script:fakeRoot 'package.json') -Value '{"name":"test"}' -Encoding utf8
        Set-Content -Path (Join-Path $script:fakeRoot 'src/index.ts') -Value 'console.log("hello")' -Encoding utf8

        # Init a git repo so git commands work
        Push-Location $script:fakeRoot
        & git init -q 2>$null
        & git add -A 2>$null
        & git commit -m 'init' -q 2>$null
        Pop-Location
    }

    AfterAll {
        $script:RepoRoot = $script:origRepoRoot
    }

    It 'returns a markdown string with Project Map header' {
        $script:RepoRoot = $script:fakeRoot
        $output = Get-ProjectMap -IncludeGitStatus $false
        $output | Should -BeOfType [string]
        $output | Should -Match '# Project Map'
    }

    It 'includes directory structure section' {
        $script:RepoRoot = $script:fakeRoot
        $output = Get-ProjectMap -IncludeGitStatus $false
        $output | Should -Match '## Directory Structure'
        $output | Should -Match 'src/'
    }

    It 'includes key files section when files exist' {
        $script:RepoRoot = $script:fakeRoot
        $output = Get-ProjectMap -IncludeGitStatus $false
        $output | Should -Match '## Key Files'
        $output | Should -Match 'CLAUDE\.md'
        $output | Should -Match 'package\.json'
    }

    It 'includes git status when -IncludeGitStatus is true' {
        $script:RepoRoot = $script:fakeRoot
        $output = Get-ProjectMap -IncludeGitStatus $true
        $output | Should -Match '## Git Status'
        $output | Should -Match 'Branch:'
    }

    It 'respects -Depth parameter' {
        $script:RepoRoot = $script:fakeRoot
        $deep = Join-Path $script:fakeRoot 'a/b/c/d'
        New-Item -ItemType Directory -Path $deep -Force | Out-Null
        Set-Content -Path (Join-Path $deep 'deep.txt') -Value 'deep' -Encoding utf8

        $shallow = Get-ProjectMap -Depth 1 -IncludeGitStatus $false
        $full = Get-ProjectMap -Depth 5 -IncludeGitStatus $false

        $shallow | Should -Not -Match 'deep\.txt'
    }

    It 'excludes node_modules and .git directories' {
        $script:RepoRoot = $script:fakeRoot
        $nmDir = Join-Path $script:fakeRoot 'node_modules/pkg'
        New-Item -ItemType Directory -Path $nmDir -Force | Out-Null
        Set-Content -Path (Join-Path $nmDir 'index.js') -Value '' -Encoding utf8

        $output = Get-ProjectMap -IncludeGitStatus $false
        $output | Should -Not -Match 'node_modules'
    }
}

Describe 'Get-ProjectHealth' -Tag 'template' {

    BeforeAll {
        $script:origRepoRoot = $script:RepoRoot
        $script:fakeRoot = Join-Path $TestDrive 'health-repo'
        New-Item -ItemType Directory -Path $script:fakeRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:fakeRoot 'scripts/MyMod') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:fakeRoot 'docs/design/adr') -Force | Out-Null

        Set-Content -Path (Join-Path $script:fakeRoot 'scripts/MyMod/MyMod.psd1') -Value @"
@{
    ModuleVersion = '1.0.0'
}
"@ -Encoding utf8

        Set-Content -Path (Join-Path $script:fakeRoot 'docs/design/adr/001-test.md') -Value @"
# ADR-001: Test

**Status:** accepted
**Date:** 2026-01-01
**Author:** Test

## Context
Test.
"@ -Encoding utf8
    }

    AfterAll {
        $script:RepoRoot = $script:origRepoRoot
    }

    It 'returns structured result with Healthy and Checks fields (-Quick)' {
        $script:RepoRoot = $script:fakeRoot
        $all = Get-ProjectHealth -Quick
        $result = @($all)[-1]
        $result.PSObject.Properties['Healthy'] | Should -Not -BeNullOrEmpty
        $result.PSObject.Properties['Checks'] | Should -Not -BeNullOrEmpty
    }

    It 'includes Version Consistency check' {
        $script:RepoRoot = $script:fakeRoot
        $all = Get-ProjectHealth -Quick
        $result = @($all)[-1]
        $vcCheck = @($result.Checks) | Where-Object { $_.Check -eq 'Version Consistency' }
        $vcCheck | Should -Not -BeNullOrEmpty
    }

    It 'includes ADR Status check' {
        $script:RepoRoot = $script:fakeRoot
        $all = Get-ProjectHealth -Quick
        $result = @($all)[-1]
        $adrCheck = @($result.Checks) | Where-Object { $_.Check -eq 'ADR Status' }
        $adrCheck | Should -Not -BeNullOrEmpty
        $adrCheck.Pass | Should -Be $true
        $adrCheck.Detail | Should -Match 'Active: 1'
    }
}

Describe 'Initialize-ProjectModule' -Tag 'template' {

    BeforeAll {
        $script:origRepoRoot = $script:RepoRoot
    }

    AfterAll {
        $script:RepoRoot = $script:origRepoRoot
    }

    It 'throws when template directory does not exist' {
        $script:RepoRoot = Join-Path $TestDrive 'init-nope'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        { Initialize-ProjectModule -ProjectName 'TestProj' } | Should -Throw
    }

    It 'throws when target directory already exists' {
        $fakeRoot = Join-Path $TestDrive 'init-exists'
        New-Item -ItemType Directory -Path $fakeRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $fakeRoot 'scripts/Project-Template') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $fakeRoot 'scripts/MyProj') -Force | Out-Null
        $script:RepoRoot = $fakeRoot

        { Initialize-ProjectModule -ProjectName 'MyProj' } | Should -Throw
    }

    It 'renames template directory and files' {
        $fakeRoot = Join-Path $TestDrive 'init-rename'
        New-Item -ItemType Directory -Path $fakeRoot -Force | Out-Null
        $templateDir = Join-Path $fakeRoot 'scripts/Project-Template'
        New-Item -ItemType Directory -Path (Join-Path $templateDir 'Public') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $templateDir 'Private') -Force | Out-Null

        Set-Content -Path (Join-Path $templateDir 'Project-Template.psd1') -Value @"
@{
    RootModule = 'Project-Template.psm1'
    ModuleVersion = '0.1.0'
    GUID = '00000000-0000-0000-0000-000000000000'
    Author = 'Template'
    Description = 'Rename this module after cloning.'
}
"@ -Encoding utf8

        Set-Content -Path (Join-Path $templateDir 'Project-Template.psm1') -Value @"
# Project-Template root module
# Rename this file after cloning the template.
"@ -Encoding utf8

        $script:RepoRoot = $fakeRoot

        $all = Initialize-ProjectModule -ProjectName 'CoolTool' -Author 'Tester' -Confirm:$false
        $result = @($all)[-1]

        $result.ProjectName | Should -Be 'CoolTool'
        $result.Author | Should -Be 'Tester'
        $result.GUID | Should -Not -Be '00000000-0000-0000-0000-000000000000'
        Test-Path (Join-Path $fakeRoot 'scripts/CoolTool') | Should -Be $true
        Test-Path (Join-Path $fakeRoot 'scripts/Project-Template') | Should -Be $false
    }

    It 'updates manifest content with new project name and author' {
        $fakeRoot = Join-Path $TestDrive 'init-content'
        New-Item -ItemType Directory -Path $fakeRoot -Force | Out-Null
        $templateDir = Join-Path $fakeRoot 'scripts/Project-Template'
        New-Item -ItemType Directory -Path $templateDir -Force | Out-Null

        Set-Content -Path (Join-Path $templateDir 'Project-Template.psd1') -Value @"
@{
    RootModule = 'Project-Template.psm1'
    ModuleVersion = '0.1.0'
    GUID = '00000000-0000-0000-0000-000000000000'
    Author = 'Template'
    Description = 'Rename this module after cloning.'
}
"@ -Encoding utf8

        Set-Content -Path (Join-Path $templateDir 'Project-Template.psm1') -Value @"
# Project-Template root module
# Rename this file after cloning the template.
"@ -Encoding utf8

        $script:RepoRoot = $fakeRoot

        $all = Initialize-ProjectModule -ProjectName 'DataPipe' -Author 'Alice' -Confirm:$false
        $result = @($all)[-1]

        $manifestPath = Join-Path $fakeRoot 'scripts/DataPipe/DataPipe.psd1'
        Test-Path $manifestPath | Should -Be $true
        $content = Get-Content $manifestPath -Raw
        $content | Should -Match "RootModule = 'DataPipe.psm1'"
        $content | Should -Match "Author = 'Alice'"
        $content | Should -Not -Match 'Project-Template'

        $psm1Path = Join-Path $fakeRoot 'scripts/DataPipe/DataPipe.psm1'
        Test-Path $psm1Path | Should -Be $true
        $psm1Content = Get-Content $psm1Path -Raw
        $psm1Content | Should -Match 'DataPipe root module'
    }

    It 'rejects invalid project names' {
        $script:RepoRoot = Join-Path $TestDrive 'init-invalid'
        New-Item -ItemType Directory -Path $script:RepoRoot -Force | Out-Null

        { Initialize-ProjectModule -ProjectName '123bad' } | Should -Throw
        { Initialize-ProjectModule -ProjectName 'has spaces' } | Should -Throw
    }
}
