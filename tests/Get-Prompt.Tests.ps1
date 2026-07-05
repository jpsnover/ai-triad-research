# Tag: template (t/1334)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-Prompt fragment injection (t/1334). Unblocks Shared Lib's
    t/1297 prompt un-fork work.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Set up an isolated Prompts directory used only by these tests. We put
    # fixture .prompt and .fragment.prompt files here and point the module
    # loader at it via $script:ModuleRoot inside InModuleScope.
    $script:FixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) "get-prompt-t1334-$(Get-Random)"
    $script:FixturePromptsDir = Join-Path $script:FixtureRoot 'Prompts'
    New-Item -ItemType Directory -Path $script:FixturePromptsDir -Force | Out-Null
}

AfterAll {
    if ($script:FixtureRoot -and (Test-Path $script:FixtureRoot)) {
        Remove-Item $script:FixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Describe 'Get-Prompt fragment injection (t/1334)' -Tag 'template' {

    BeforeEach {
        # Fresh fixtures + fresh module cache each test so state doesn't leak
        Get-ChildItem -Path $script:FixturePromptsDir -Filter '*.prompt' -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        InModuleScope AITriad {
            $script:PromptCache = @{}
            $script:PromptFragmentCache = @{}
        }
    }

    It 'Injects a matching .fragment.prompt when the placeholder has no caller value' {
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'demo.prompt') `
            -Value "vocab: {{attribute-vocabulary}}" -Encoding utf8NoBOM -NoNewline
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'attribute-vocabulary.fragment.prompt') `
            -Value "temperament, epistemology, agenda" -Encoding utf8NoBOM -NoNewline

        InModuleScope AITriad -Parameters @{ Root = $script:FixtureRoot } {
            param($Root)
            $orig = $script:ModuleRoot
            $script:ModuleRoot = $Root
            try {
                $out = Get-Prompt -Name 'demo' -WarningAction SilentlyContinue
                $out | Should -Be 'vocab: temperament, epistemology, agenda'
            } finally {
                $script:ModuleRoot = $orig
            }
        }
    }

    It 'Caller-supplied value takes precedence over the fragment file' {
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'demo.prompt') `
            -Value "vocab: {{attribute-vocabulary}}" -Encoding utf8NoBOM -NoNewline
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'attribute-vocabulary.fragment.prompt') `
            -Value "FROM-FRAGMENT" -Encoding utf8NoBOM -NoNewline

        InModuleScope AITriad -Parameters @{ Root = $script:FixtureRoot } {
            param($Root)
            $orig = $script:ModuleRoot
            $script:ModuleRoot = $Root
            try {
                $out = Get-Prompt -Name 'demo' -Replacements @{ 'attribute-vocabulary' = 'FROM-CALLER' } -WarningAction SilentlyContinue
                $out | Should -Be 'vocab: FROM-CALLER'
                $out | Should -Not -Match 'FROM-FRAGMENT'
            } finally {
                $script:ModuleRoot = $orig
            }
        }
    }

    It 'Falls through as literal {{name}} when no fragment file exists (backward compat)' {
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'demo.prompt') `
            -Value "unknown: {{nope}}" -Encoding utf8NoBOM -NoNewline

        InModuleScope AITriad -Parameters @{ Root = $script:FixtureRoot } {
            param($Root)
            $orig = $script:ModuleRoot
            $script:ModuleRoot = $Root
            try {
                $out = Get-Prompt -Name 'demo' -WarningAction SilentlyContinue
                $out | Should -Be 'unknown: {{nope}}'
            } finally {
                $script:ModuleRoot = $orig
            }
        }
    }

    It 'Fragment injection is non-recursive: inner {{...}} in the fragment stays literal' {
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'demo.prompt') `
            -Value "outer: {{outer}}" -Encoding utf8NoBOM -NoNewline
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'outer.fragment.prompt') `
            -Value "content with {{inner}} placeholder" -Encoding utf8NoBOM -NoNewline
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'inner.fragment.prompt') `
            -Value "should-not-appear" -Encoding utf8NoBOM -NoNewline

        InModuleScope AITriad -Parameters @{ Root = $script:FixtureRoot } {
            param($Root)
            $orig = $script:ModuleRoot
            $script:ModuleRoot = $Root
            try {
                $out = Get-Prompt -Name 'demo' -WarningAction SilentlyContinue
                $out | Should -Be 'outer: content with {{inner}} placeholder'
                $out | Should -Not -Match 'should-not-appear'
            } finally {
                $script:ModuleRoot = $orig
            }
        }
    }

    It 'Placeholder regex matches lowercase-hyphenated names (attribute-vocabulary)' {
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'demo.prompt') `
            -Value "{{attribute-vocabulary}} and {{edge-type-vocabulary}}" -Encoding utf8NoBOM -NoNewline
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'attribute-vocabulary.fragment.prompt') `
            -Value "A" -Encoding utf8NoBOM -NoNewline
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'edge-type-vocabulary.fragment.prompt') `
            -Value "B" -Encoding utf8NoBOM -NoNewline

        InModuleScope AITriad -Parameters @{ Root = $script:FixtureRoot } {
            param($Root)
            $orig = $script:ModuleRoot
            $script:ModuleRoot = $Root
            try {
                $out = Get-Prompt -Name 'demo' -WarningAction SilentlyContinue
                $out | Should -Be 'A and B'
            } finally {
                $script:ModuleRoot = $orig
            }
        }
    }

    It 'Legacy uppercase {{KEY}} replacements still work (regression guard)' {
        Set-Content -Path (Join-Path $script:FixturePromptsDir 'demo.prompt') `
            -Value "Hello {{NAME}}, welcome to {{POV}}." -Encoding utf8NoBOM -NoNewline

        InModuleScope AITriad -Parameters @{ Root = $script:FixtureRoot } {
            param($Root)
            $orig = $script:ModuleRoot
            $script:ModuleRoot = $Root
            try {
                $out = Get-Prompt -Name 'demo' -Replacements @{ NAME = 'Skeptic'; POV = 'the debate' } -WarningAction SilentlyContinue
                $out | Should -Be 'Hello Skeptic, welcome to the debate.'
            } finally {
                $script:ModuleRoot = $orig
            }
        }
    }
}
