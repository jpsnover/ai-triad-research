# Tag: unit (t/3997)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# t/3997 (SO e/254#6 cond 2a): PowerShell does not implement tag selection for op-eds —
# -PovTag / -TagMode must refuse with an ActionableError rather than diverge from the
# TS implementation's included/excludedUntagged counts. The refusal fires before any
# other work (soul load, outlet resolution, API call), so no mocking is needed here.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'New-OpEd rejects tag selection (t/3997)' -Tag 'unit' {

    It 'refuses -PovTag with an ActionableError naming the TS-only app/server path' {
        $err = $null
        try { New-OpEd -Topic 'x' -Pov skeptic -PovTag 'critical' } catch { $err = $_ }
        $err | Should -Not -BeNullOrEmpty
        $msg = $err.Exception.Message
        $msg | Should -Match 'Error:'
        $msg | Should -Match 'Resolve:'
        $msg | Should -Match "doesn't implement tag selection"
    }

    It 'refuses -TagMode alone (without -PovTag) too' {
        $err = $null
        try { New-OpEd -Topic 'x' -Pov skeptic -TagMode scope } catch { $err = $_ }
        $err | Should -Not -BeNullOrEmpty
        $err.Exception.Message | Should -Match 'Error:'
    }

    It '-TagMode validates against the known set at parameter binding' {
        { New-OpEd -Topic 'x' -Pov skeptic -TagMode bogus } | Should -Throw
    }
}
