# Tag: unit (t/2530)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    L4 regression (t/2530): Get-PandocHtmlArgs (used by Show-Markdown) must pass
    --sandbox so pandoc cannot read arbitrary local files referenced by untrusted
    Markdown. Pure PS, keyless — always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-PandocHtmlArgs (t/2530 L4)' -Tag 'unit' {

    It 'includes --sandbox' {
        InModuleScope AITriad {
            $pandocArgs = Get-PandocHtmlArgs -InputPath 'in.md' -OutputPath 'out.html' -Title 'T' -HeaderFile 'h.html'
            $pandocArgs | Should -Contain '--sandbox'
        }
    }

    It 'places --sandbox before the input path so it applies to the conversion' {
        InModuleScope AITriad {
            $pandocArgs = Get-PandocHtmlArgs -InputPath 'in.md' -OutputPath 'out.html' -Title 'T' -HeaderFile 'h.html'
            [array]::IndexOf($pandocArgs, '--sandbox') | Should -BeLessThan ([array]::IndexOf($pandocArgs, 'in.md'))
        }
    }

    It 'still wires the output, header, and title through' {
        InModuleScope AITriad {
            $pandocArgs = Get-PandocHtmlArgs -InputPath 'in.md' -OutputPath 'out.html' -Title 'My Title' -HeaderFile 'h.html'
            $pandocArgs | Should -Contain 'out.html'
            $pandocArgs | Should -Contain 'h.html'
            $pandocArgs | Should -Contain 'title=My Title'
        }
    }
}
