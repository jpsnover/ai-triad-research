# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Tag: security (t/4099, SO e/282#2 condition 4)

#Requires -Module Pester

<#
.SYNOPSIS
    Repair-PovLineage fails closed on a model id that ai-models.json doesn't register, and the error
    says so in actionable terms. Two layers:
      1. -Model's [ValidateScript(Test-AIModelId)] rejects the id at parameter binding.
      2. If that check is bypassed -- Test-AIModelId fails OPEN when the registry list is empty (t/3867)
         -- the backend lookup (Get-AIModelBackend, t/4087) still refuses: no prefix guess, no gemini
         default, and no AI call is made.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    $script:Unregistered = 'zz-unregistered-model-t4099'   # model-lint:allow-nonselect deliberately unregistered id; tests the fail-closed path (t/4099)
}

Describe 'Repair-PovLineage fails closed on an unregistered model id (t/4099)' -Tag 'security' {

    BeforeEach {
        $script:Root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:TaxDir = Join-Path $script:Root 'taxonomy' 'Origin'
        New-Item -ItemType Directory -Path $script:TaxDir -Force | Out-Null
        Mock Get-TaxonomyDir -ModuleName AITriad { $script:TaxDir }
        Mock Get-DataRoot -ModuleName AITriad { $script:Root }
        Mock Get-Prompt -ModuleName AITriad { 'prompt' }
        Mock Invoke-AIApi -ModuleName AITriad { throw 'Invoke-AIApi must not be called for an unregistered model' }
    }

    It 'layer 1: parameter validation rejects the unregistered id' {
        { Repair-PovLineage -Model $script:Unregistered -RegenerateContent -WarningAction SilentlyContinue 6> $null } |
            Should -Throw -ExpectedMessage "*Invalid model '$($script:Unregistered)'*"
        Should -Invoke Invoke-AIApi -ModuleName AITriad -Times 0 -Exactly
    }

    It 'layer 2: with validation failed open, the backend lookup refuses with an actionable error' {
        $Saved = InModuleScope AITriad { $script:ValidModelIds }
        try {
            InModuleScope AITriad { $script:ValidModelIds = @() }   # Test-AIModelId fails open (t/3867)
            $err = $null
            try { Repair-PovLineage -Model $script:Unregistered -RegenerateContent -WarningAction SilentlyContinue 6> $null }
            catch { $err = $_.Exception.Message }

            $err | Should -Not -BeNullOrEmpty
            $err | Should -Match ([regex]::Escape("'$($script:Unregistered)'"))                      # names the id
            $err | Should -Match 'is not a model id registered in ai-models\.json'                    # says why
            $err | Should -Match 'Use a model id registered in ai-models\.json'                       # step 1: use a registry id
            $err | Should -Match 'add it to ai-models\.json with its backend'                         # step 2: or register it
            $err | Should -Not -Match '(?i)gemini_api_key'                                            # no gemini default
        }
        finally {
            InModuleScope AITriad -Parameters @{ S = $Saved } { param($S) $script:ValidModelIds = $S }
        }
        Should -Invoke Invoke-AIApi -ModuleName AITriad -Times 0 -Exactly
    }
}
