# Tag: security (t/4087)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/4087: a model's backend comes only from ai-models.json, and an env-var key only ever reaches the
    backend it is named for.
.DESCRIPTION
    ~20 cmdlets guessed the backend from the model id prefix (else gemini), resolved a key for the guess
    and passed it EXPLICITLY to Invoke-AIApi, so a registered xai-/deepseek-/azure-/zai-/moonshot- model
    was sent GEMINI_API_KEY. Every cmdlet now asks Get-AIModelBackend / Get-AIModelKeyStatus (registry
    only, fail closed) and forwards only the user's -ApiKey; Resolve-AIApiKey refuses a key that is
    another backend's named credential.

    Condition 4 (completeness): every registered model id is enumerated from ai-models.json at test time,
    never from a pinned list. Condition 3: the Resolve-AIApiKey guard.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    $script:Registry = Get-Content -Raw (Join-Path $PSScriptRoot '..' 'ai-models.json') | ConvertFrom-Json
    $script:Models = @($script:Registry.models | ForEach-Object { [pscustomobject]@{ Id = [string]$_.id; Backend = [string]$_.backend } })

    # Every variable Resolve-AIApiKey consults, so each test starts from a known environment.
    $script:KeyVars = @('GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY',
        'AZURE_OPENAI_API_KEY', 'ZAI_API_KEY', 'MOONSHOT_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'AI_API_KEY')
    $script:VarOf = @{ gemini = 'GEMINI_API_KEY'; claude = 'ANTHROPIC_API_KEY'; groq = 'GROQ_API_KEY'; openai = 'OPENAI_API_KEY'
        azure = 'AZURE_OPENAI_API_KEY'; zai = 'ZAI_API_KEY'; moonshot = 'MOONSHOT_API_KEY'; xai = 'XAI_API_KEY'; deepseek = 'DEEPSEEK_API_KEY' }

    function Clear-KeyEnv { foreach ($v in $script:KeyVars) { [Environment]::SetEnvironmentVariable($v, $null) } }
    function Reset-FallbackWarned { InModuleScope AIEnrich { $script:AIApiKeyFallbackWarned = @{} } }
}

Describe 'Model backend and key routing (t/4087)' -Tag 'security' {

BeforeEach {
    $script:SavedEnv = @{}
    foreach ($v in $script:KeyVars) { $script:SavedEnv[$v] = [Environment]::GetEnvironmentVariable($v) }
    Clear-KeyEnv
    Reset-FallbackWarned
}

AfterEach {
    foreach ($v in $script:KeyVars) { [Environment]::SetEnvironmentVariable($v, $script:SavedEnv[$v]) }
}

Describe 'Get-AIModelBackend: the registry is the only source (t/4087 condition 1, 2, 4)' -Tag 'security' {

    It 'the registry is non-trivial (guards against an empty enumeration passing vacuously)' {
        $script:Models.Count | Should -BeGreaterThan 20
        @($script:Models | Where-Object { $_.Backend -notin @('gemini', 'claude', 'groq', 'openai') }).Count | Should -BeGreaterThan 0
    }

    It 'every registered model id resolves to exactly its ai-models.json backend' {
        $Mismatches = InModuleScope AITriad -Parameters @{ Models = $script:Models } {
            param($Models)
            @($Models | Where-Object { (Get-AIModelBackend -Model $_.Id) -cne $_.Backend } | ForEach-Object { "$($_.Id) -> expected $($_.Backend)" })
        }
        $Mismatches | Should -BeNullOrEmpty
    }

    It 'a model registered under an unfamiliar prefix resolves to its registry backend, not a prefix guess' {
        # A prefix guess (else gemini) gets this wrong; reading the registry gets it right.
        InModuleScope AITriad {
            $Saved = $script:AIModelConfig
            try {
                $script:AIModelConfig = [pscustomobject]@{ models = @($Saved.models) + @([pscustomobject]@{ id = 'zzunknownprefix-model-1'; backend = 'xai' }) }
                Get-AIModelBackend -Model 'zzunknownprefix-model-1' | Should -Be 'xai'   # model-lint:allow-nonselect synthetic registry entry added in this test to prove resolution ignores the prefix (t/4087)
            } finally { $script:AIModelConfig = $Saved }
        }
    }

    It 'fails closed: an unregistered model id throws an actionable error instead of defaulting' {
        InModuleScope AITriad {
            { Get-AIModelBackend -Model 'not-a-registered-model' } | Should -Throw -ExpectedMessage "*not a model id registered in ai-models.json*"   # model-lint:allow-nonselect deliberately unregistered id; tests the fail-closed path (t/4087)
        }
    }

    It 'fails closed: a registry entry without a backend throws instead of defaulting' {
        InModuleScope AITriad {
            $Saved = $script:AIModelConfig
            try {
                $script:AIModelConfig = [pscustomobject]@{ models = @([pscustomobject]@{ id = 'no-backend-model' }) }
                { Get-AIModelBackend -Model 'no-backend-model' } | Should -Throw -ExpectedMessage "*has no 'backend'*"   # model-lint:allow-nonselect synthetic entry without a backend; tests the fail-closed path (t/4087)
            } finally { $script:AIModelConfig = $Saved }
        }
    }
}

Describe 'No registered model is ever offered another backend''s env key (t/4087 condition 3, 4)' -Tag 'security' {

    It 'with every OTHER backend''s key variable set, Get-AIModelKeyStatus reports no key for <Id> (<Backend>)' -ForEach @(
        (Get-Content -Raw (Join-Path $PSScriptRoot '..' 'ai-models.json') | ConvertFrom-Json).models |
            Where-Object { $_.backend -ne 'ollama' } | ForEach-Object { @{ Id = [string]$_.id; Backend = [string]$_.backend } }
    ) {
        foreach ($b in $script:VarOf.Keys) {
            if ($b -ne $Backend) { [Environment]::SetEnvironmentVariable($script:VarOf[$b], "foreign-sentinel-$b") }
        }
        $Status = InModuleScope AITriad -Parameters @{ Id = $Id } { param($Id) Get-AIModelKeyStatus -Model $Id -ApiKey '' }
        $Status.Backend | Should -Be $Backend
        $Status.HasKey | Should -BeFalse -Because "only $($script:VarOf[$Backend]) may supply a key for $Id"
    }
}

Describe 'Resolve-AIApiKey: env keys only reach their own backend (t/4087 condition 3)' -Tag 'security' {
    # Resolve-AIApiKey lives in AIEnrich, which AITriad imports into its own scope; call that instance.
    BeforeAll {
        function Invoke-ResolveKey {
            param([string]$ExplicitKey = '', [string]$Backend)
            InModuleScope AIEnrich -Parameters @{ K = $ExplicitKey; B = $Backend } {
                param($K, $B)
                $Value = Resolve-AIApiKey -ExplicitKey $K -Backend $B -WarningVariable w -WarningAction SilentlyContinue
                [pscustomobject]@{ Value = $Value; Warnings = @($w | ForEach-Object { "$_" }) }
            }
        }
    }

    It 'returns a backend''s own named variable' {
        $env:XAI_API_KEY = 'own-xai-sentinel'
        (Invoke-ResolveKey -Backend 'xai').Value | Should -Be 'own-xai-sentinel'
    }

    It 'refuses an explicit key that is another backend''s named credential, naming the variable but not the key' {
        $env:GEMINI_API_KEY = 'gemini-secret-sentinel'
        $Err = $null
        try { Invoke-ResolveKey -ExplicitKey 'gemini-secret-sentinel' -Backend 'xai' } catch { $Err = "$_" }
        $Err | Should -Match 'GEMINI_API_KEY'
        $Err | Should -Not -Match 'gemini-secret-sentinel'
    }

    It 'allows an explicit key that is the requested backend''s own credential' {
        $env:GEMINI_API_KEY = 'gemini-secret-sentinel'
        (Invoke-ResolveKey -ExplicitKey 'gemini-secret-sentinel' -Backend 'gemini').Value | Should -Be 'gemini-secret-sentinel'
    }

    It 'allows an explicit key that is no backend''s variable (the user''s own explicit choice)' {
        $env:GEMINI_API_KEY = 'gemini-secret-sentinel'
        (Invoke-ResolveKey -ExplicitKey 'user-supplied-xai-key' -Backend 'xai').Value | Should -Be 'user-supplied-xai-key'
    }

    It 'refuses the AI_API_KEY fallback when it is another backend''s named credential' {
        $env:GEMINI_API_KEY = 'shared-sentinel'
        $env:AI_API_KEY = 'shared-sentinel'
        { Invoke-ResolveKey -Backend 'claude' } | Should -Throw -ExpectedMessage '*AI_API_KEY fallback*GEMINI_API_KEY*'
    }

    It 'uses a distinct AI_API_KEY fallback, warning once per backend' {
        $env:AI_API_KEY = 'generic-sentinel'
        $First = Invoke-ResolveKey -Backend 'deepseek'
        $Second = Invoke-ResolveKey -Backend 'deepseek'
        $First.Value | Should -Be 'generic-sentinel'
        $Second.Value | Should -Be 'generic-sentinel'
        @($First.Warnings).Count | Should -Be 1
        $First.Warnings[0] | Should -Match "AI_API_KEY.*'deepseek'"
        @($Second.Warnings).Count | Should -Be 0
    }
}

Describe 'A cmdlet never forwards another backend''s env key (t/4087 end to end)' -Tag 'security' {

    It 'Find-PolicyAction with an xai model and only GEMINI_API_KEY set fails for the xai backend and makes no AI call' {
        $env:GEMINI_API_KEY = 'gemini-secret-sentinel'
        $XaiModel = @($script:Models | Where-Object { $_.Backend -eq 'xai' })[0].Id
        $Tax = Join-Path $TestDrive 'taxonomy'
        $null = New-Item -ItemType Directory -Path $Tax -Force
        Mock Get-TaxonomyDir -ModuleName AITriad { $Tax }
        Mock Invoke-AIApi -ModuleName AITriad { throw 'Invoke-AIApi must not be called' }
        { Find-PolicyAction -Model $XaiModel *> $null } | Should -Throw -ExpectedMessage 'No API key configured'
        Should -Invoke Invoke-AIApi -ModuleName AITriad -Times 0 -Exactly
    }
}

}
