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

    It 'refuses the gemini AI_API_KEY fallback when it is another backend''s named credential' {
        $env:ANTHROPIC_API_KEY = 'shared-sentinel'
        $env:AI_API_KEY = 'shared-sentinel'
        { Invoke-ResolveKey -Backend 'gemini' } | Should -Throw -ExpectedMessage '*AI_API_KEY fallback*ANTHROPIC_API_KEY*'
    }

    It 'gemini uses a distinct AI_API_KEY fallback, warning once (t/4102)' {
        $env:AI_API_KEY = 'generic-sentinel'
        $First = Invoke-ResolveKey -Backend 'gemini'
        $Second = Invoke-ResolveKey -Backend 'gemini'
        $First.Value | Should -Be 'generic-sentinel'
        $Second.Value | Should -Be 'generic-sentinel'
        @($First.Warnings).Count | Should -Be 1
        $First.Warnings[0] | Should -Match "AI_API_KEY.*'gemini'"
        @($Second.Warnings).Count | Should -Be 0
    }
}

Describe 'AI_API_KEY is a fallback for the gemini backend only (t/4102)' -Tag 'security' {
    # Every keyed backend in ai-models.json except gemini, enumerated at test time (never a pinned list).
    BeforeAll {
        $script:NonGeminiBackends = @($script:Models.Backend | Where-Object { $_ -notin @('gemini', 'ollama') } | Sort-Object -Unique)
    }

    It 'the registry has non-gemini keyed backends to check (guards against a vacuous pass)' {
        $script:NonGeminiBackends.Count | Should -BeGreaterThan 3
    }

    It '<_>: a set AI_API_KEY is refused with an error naming the backend''s own variable, never returned' -ForEach @(
        @((Get-Content -Raw (Join-Path $PSScriptRoot '..' 'ai-models.json') | ConvertFrom-Json).models.backend |
            Where-Object { $_ -notin @('gemini', 'ollama') } | Sort-Object -Unique)
    ) {
        $env:AI_API_KEY = 'generic-sentinel'
        $Backend = $_
        $r = InModuleScope AIEnrich -Parameters @{ B = $Backend } {
            param($B)
            $Value = $null; $Err = $null
            try { $Value = Resolve-AIApiKey -Backend $B } catch { $Err = "$_" }
            [pscustomobject]@{ Value = $Value; Err = $Err; Source = $script:LastApiKeySource }
        }
        $r.Value | Should -BeNullOrEmpty -Because "AI_API_KEY must never reach the '$Backend' backend"
        $r.Err | Should -Match "no key for backend '$Backend'"
        $r.Err | Should -Match ([regex]::Escape($script:VarOf[$Backend]))
        $r.Err | Should -Match 'gemini backend only'
        $r.Err | Should -Not -Match 'generic-sentinel' -Because 'the error names variables, never key material'
        $r.Source | Should -Match 'refused'
    }

    It '<_>: with nothing set, there is still no error, just no key (unchanged)' -ForEach @(
        @((Get-Content -Raw (Join-Path $PSScriptRoot '..' 'ai-models.json') | ConvertFrom-Json).models.backend |
            Where-Object { $_ -notin @('gemini', 'ollama') } | Sort-Object -Unique)
    ) {
        $Backend = $_
        $Value = InModuleScope AIEnrich -Parameters @{ B = $Backend } { param($B) Resolve-AIApiKey -Backend $B }
        $Value | Should -BeNullOrEmpty
    }

    It 'a registered <Backend> model with only AI_API_KEY set reports no key at the status check, without throwing (SO e/284#2 cond. 1)' -ForEach @(
        (Get-Content -Raw (Join-Path $PSScriptRoot '..' 'ai-models.json') | ConvertFrom-Json).models |
            Where-Object { $_.backend -notin @('gemini', 'ollama') } | Group-Object backend | ForEach-Object { @{ Backend = $_.Name; Id = [string]$_.Group[0].id } }
    ) {
        $env:AI_API_KEY = 'generic-sentinel'
        $r = InModuleScope AITriad -Parameters @{ Id = $Id } {
            param($Id)
            $s = Get-AIModelKeyStatus -Model $Id -ApiKey '' -WarningVariable w -WarningAction SilentlyContinue
            [pscustomobject]@{ Status = $s; Warnings = @($w | ForEach-Object { "$_" }) }
        }
        $r.Status.HasKey | Should -BeFalse
        $r.Status.EnvHint | Should -Be $script:VarOf[$Backend]
        @($r.Warnings).Count | Should -Be 1 -Because 'the not-configured outcome is a fallback and says why'
        $r.Warnings[0] | Should -Match 'applies to gemini only'
        $r.Warnings[0] | Should -Not -Match 'generic-sentinel'
    }

    It 'a foreign-credential refusal still propagates from the status check (only the gemini-only refusal is softened)' {
        $env:GEMINI_API_KEY = 'gemini-secret-sentinel'
        $XaiModel = @($script:Models | Where-Object { $_.Backend -eq 'xai' })[0].Id
        { InModuleScope AITriad -Parameters @{ Id = $XaiModel } { param($Id) Get-AIModelKeyStatus -Model $Id -ApiKey 'gemini-secret-sentinel' } } |
            Should -Throw -ExpectedMessage '*GEMINI_API_KEY*'
    }

    It 'listing: Test-AIProviderKeyStatus with only AI_API_KEY set shows gemini configured and the rest not, without throwing' {
        $env:AI_API_KEY = 'generic-sentinel'
        Mock -ModuleName AITriad Invoke-WebRequest { [pscustomobject]@{ StatusCode = 200; Headers = @{} } }
        $Rows = InModuleScope AITriad { @(Test-AIProviderKeyStatus -WarningAction SilentlyContinue) }
        @($Rows).Count | Should -Be 4
        ($Rows | Where-Object Backend -eq 'gemini').KeyConfigured | Should -BeTrue
        foreach ($Row in @($Rows | Where-Object Backend -ne 'gemini')) {
            $Row.KeyConfigured | Should -BeFalse -Because "AI_API_KEY must not configure '$($Row.Backend)'"
            $Row.KeySource | Should -Match 'gemini-only'
        }
        Should -Invoke -ModuleName AITriad Invoke-WebRequest -Times 1 -Exactly -Because 'only gemini has a key to probe'
    }

    It 'sweep: Test-AIApiKey -All with only AI_API_KEY set reports each non-gemini backend unkeyed, without throwing' {
        $env:AI_API_KEY = 'generic-sentinel'
        Mock -ModuleName AITriad Invoke-RestMethod { [pscustomobject]@{ data = @(); models = @() } }
        $Rows = @(Test-AIApiKey -All)
        foreach ($b in @('claude', 'groq', 'openai')) {
            $Row = $Rows | Where-Object Backend -eq $b
            $Row.Functional | Should -BeFalse
            $Row.ErrorMessage | Should -Match 'applies to gemini only'
            $Row.ErrorMessage | Should -Not -Match 'generic-sentinel'
        }
        Should -Invoke -ModuleName AITriad Invoke-RestMethod -ParameterFilter { $Uri -match 'anthropic|groq|openai\.com' } -Times 0 -Exactly
    }

    It 'use: a claude call with only AI_API_KEY set still refuses, naming ANTHROPIC_API_KEY' {
        $env:AI_API_KEY = 'generic-sentinel'
        $ClaudeModel = @($script:Models | Where-Object { $_.Backend -eq 'claude' })[0].Id
        { InModuleScope AIEnrich -Parameters @{ M = $ClaudeModel } { param($M) Invoke-AIApi -Prompt 'x' -Model $M -FallbackModels @() } } |
            Should -Throw -ExpectedMessage '*ANTHROPIC_API_KEY*'
    }

    It 'use: a claude PRIMARY with only AI_API_KEY set and gemini in the chain throws; gemini never serves it (SO e/284#10)' {
        # The cascade softening is for secondary links only. Serving a claude request from gemini would silently
        # change the provider the user asked for, so the primary refusal must surface before any provider call.
        $env:AI_API_KEY = 'generic-sentinel'
        $ClaudeModel = @($script:Models | Where-Object { $_.Backend -eq 'claude' })[0].Id
        $GeminiModel = @($script:Models | Where-Object { $_.Backend -eq 'gemini' })[0].Id
        Mock -ModuleName AIEnrich Invoke-RestMethod { throw 'provider mock must not be called' }
        $Err = $null
        try {
            InModuleScope AIEnrich -Parameters @{ M = $ClaudeModel; Fb = $GeminiModel } {
                param($M, $Fb)
                Invoke-AIApi -Prompt 'x' -Model $M -FallbackModels @($Fb) -MaxRetries 1 -RetryDelays @(0) -SkipTokenCheck -WarningAction SilentlyContinue
            }
        } catch { $Err = "$_" }
        $Err | Should -Match "no key for backend 'claude'"
        $Err | Should -Match 'ANTHROPIC_API_KEY'
        $Err | Should -Not -Match 'generic-sentinel'
        Should -Invoke -ModuleName AIEnrich Invoke-RestMethod -Times 0 -Exactly -Because 'no provider, gemini included, may be called'
    }

    It 'control: the same chain still fails over to gemini when the claude primary fails with an ordinary transient error (SO e/284#12)' {
        # Proves the exclusion above is narrow: failover itself is not switched off.
        $env:AI_API_KEY = 'generic-sentinel'
        $env:ANTHROPIC_API_KEY = 'own-claude-sentinel'
        $ClaudeModel = @($script:Models | Where-Object { $_.Backend -eq 'claude' })[0].Id
        $GeminiModel = @($script:Models | Where-Object { $_.Backend -eq 'gemini' })[0].Id
        Mock -ModuleName AIEnrich Invoke-RestMethod {
            if ($Uri -match 'anthropic') { throw [System.Net.Http.HttpRequestException]::new('simulated transient claude failure') }
            [pscustomobject]@{ candidates = @([pscustomobject]@{ finishReason = 'STOP'; content = [pscustomobject]@{ parts = @([pscustomobject]@{ text = 'served-by-gemini' }) } }) }
        }
        $r = InModuleScope AIEnrich -Parameters @{ M = $ClaudeModel; Fb = $GeminiModel } {
            param($M, $Fb)
            Invoke-AIApi -Prompt 'x' -Model $M -FallbackModels @($Fb) -MaxRetries 1 -RetryDelays @(0) -SkipTokenCheck -WarningAction SilentlyContinue
        }
        $r.Text | Should -Be 'served-by-gemini'
        Should -Invoke -ModuleName AIEnrich Invoke-RestMethod -ParameterFilter { $Uri -match 'anthropic' } -Times 1
        Should -Invoke -ModuleName AIEnrich Invoke-RestMethod -ParameterFilter { $Uri -match 'googleapis' } -Times 1 -Exactly
    }

    It 'listing: Test-AIProviderKeyStatus surfaces a foreign-credential refusal, never softens it (site-level arm)' {
        # Pins the listing SITE: a catch-everything soften here would report gemini "not configured" instead.
        # The gemini row's only key (AI_API_KEY) is the value of GROQ_API_KEY: a foreign-credential refusal.
        $env:GROQ_API_KEY = 'groq-secret-sentinel'
        $env:AI_API_KEY = 'groq-secret-sentinel'
        Mock -ModuleName AITriad Invoke-WebRequest { throw 'no probe may run' }
        $Err = $null
        try { InModuleScope AITriad { Test-AIProviderKeyStatus -WarningAction SilentlyContinue } } catch { $Err = "$_" }
        $Err | Should -Match 'GROQ_API_KEY'
        $Err | Should -Not -Match 'groq-secret-sentinel'
        Should -Invoke -ModuleName AITriad Invoke-WebRequest -Times 0 -Exactly
    }

    It 'sweep: Test-AIApiKey -All surfaces a foreign-credential refusal, never softens it (site-level arm)' {
        $env:GROQ_API_KEY = 'groq-secret-sentinel'
        $env:AI_API_KEY = 'groq-secret-sentinel'
        Mock -ModuleName AITriad Invoke-RestMethod { throw 'no probe may run with another backend''s credential' } -ParameterFilter { $Uri -match 'googleapis' }
        Mock -ModuleName AITriad Invoke-RestMethod { [pscustomobject]@{ data = @(); models = @() } }
        $Err = $null
        try { $null = Test-AIApiKey -All } catch { $Err = "$_" }
        $Err | Should -Match 'GROQ_API_KEY'
        $Err | Should -Not -Match 'groq-secret-sentinel'
        Should -Invoke -ModuleName AITriad Invoke-RestMethod -ParameterFilter { $Uri -match 'googleapis' } -Times 0 -Exactly
    }

    It 'cascade: a SECONDARY link whose key is another backend''s credential surfaces the refusal, never skipped (SO e/284#35 gap)' {
        # Pins the cascade SITE, not just the classifier: a catch-everything soften at the secondary link would
        # WARN-and-skip this foreign refusal and return $null. Here the gemini link's only key (AI_API_KEY) is the
        # value of GROQ_API_KEY, so resolving it is a foreign-credential refusal that must reach the caller.
        $env:ANTHROPIC_API_KEY = 'own-claude-sentinel'
        $env:GROQ_API_KEY = 'groq-secret-sentinel'
        $env:AI_API_KEY = 'groq-secret-sentinel'
        $ClaudeModel = @($script:Models | Where-Object { $_.Backend -eq 'claude' })[0].Id
        $GeminiModel = @($script:Models | Where-Object { $_.Backend -eq 'gemini' })[0].Id
        Mock -ModuleName AIEnrich Invoke-RestMethod {
            if ($Uri -match 'anthropic') { throw [System.Net.Http.HttpRequestException]::new('simulated transient claude failure') }
            throw 'gemini must not be called with another backend''s credential'
        }
        $Err = $null
        try {
            InModuleScope AIEnrich -Parameters @{ M = $ClaudeModel; Fb = $GeminiModel } {
                param($M, $Fb)
                Invoke-AIApi -Prompt 'x' -Model $M -FallbackModels @($Fb) -MaxRetries 1 -RetryDelays @(0) -SkipTokenCheck -WarningAction SilentlyContinue
            }
        } catch { $Err = "$_" }
        $Err | Should -Match 'GROQ_API_KEY' -Because 'the foreign-credential refusal must propagate from the secondary link'
        $Err | Should -Not -Match 'groq-secret-sentinel'
        Should -Invoke -ModuleName AIEnrich Invoke-RestMethod -ParameterFilter { $Uri -match 'googleapis' } -Times 0 -Exactly
    }

    It 'classification is by error kind: only the gemini-only refusal matches, a foreign-credential refusal does not' {
        $env:AI_API_KEY = 'generic-sentinel'
        $GeminiOnly = InModuleScope AIEnrich { try { Resolve-AIApiKey -Backend 'claude' } catch { $_ } }
        $env:AI_API_KEY = $null
        $env:GEMINI_API_KEY = 'gemini-secret-sentinel'
        $Foreign = InModuleScope AIEnrich { try { Resolve-AIApiKey -ExplicitKey 'gemini-secret-sentinel' -Backend 'xai' } catch { $_ } }
        $GeminiOnly | Should -BeOfType [System.Management.Automation.ErrorRecord]
        $Foreign | Should -BeOfType [System.Management.Automation.ErrorRecord]
        InModuleScope AIEnrich -Parameters @{ E = $GeminiOnly } { param($E) Test-AIApiKeyGeminiOnlyRefusal -ErrorRecord $E } | Should -BeTrue
        InModuleScope AIEnrich -Parameters @{ E = $Foreign } { param($E) Test-AIApiKeyGeminiOnlyRefusal -ErrorRecord $E } | Should -BeFalse
        # Kind names are a cross-language contract with lib/ai-client (TL e/284#14): logs read the same from both tools.
        $GeminiOnly.FullyQualifiedErrorId | Should -BeLike 'AIApiKeyGeminiOnlyRefused*'
        $Foreign.FullyQualifiedErrorId | Should -BeLike 'AIApiKeyForeignCredentialRefused*'
    }

    It 'cascade: a non-gemini fallback with only AI_API_KEY set is skipped with a WARN, not thrown' {
        $env:AI_API_KEY = 'generic-sentinel'
        $ClaudeModel = @($script:Models | Where-Object { $_.Backend -eq 'claude' })[0].Id
        $GeminiModel = @($script:Models | Where-Object { $_.Backend -eq 'gemini' })[0].Id
        # The gemini primary fails; the claude fallback has no key of its own. Before the fix the cascade threw.
        Mock -ModuleName AIEnrich Invoke-RestMethod { throw [System.Net.Http.HttpRequestException]::new('simulated primary failure') }
        {
            $script:Out = InModuleScope AIEnrich -Parameters @{ M = $GeminiModel; Fb = $ClaudeModel } {
                param($M, $Fb)
                $r = Invoke-AIApi -Prompt 'x' -Model $M -FallbackModels @($Fb) -MaxRetries 1 -RetryDelays @(0) -SkipTokenCheck -WarningVariable w -WarningAction SilentlyContinue
                [pscustomobject]@{ Result = $r; Warnings = @($w | ForEach-Object { "$_" }) }
            }
        } | Should -Not -Throw
        $script:Out.Result | Should -BeNullOrEmpty
        @($script:Out.Warnings | Where-Object { $_ -match "Cascade: skipping .*applies to gemini only" }).Count | Should -Be 1
        @($script:Out.Warnings | Where-Object { $_ -match 'generic-sentinel' }).Count | Should -Be 0
        Should -Invoke -ModuleName AIEnrich Invoke-RestMethod -ParameterFilter { $Uri -match 'anthropic' } -Times 0 -Exactly
    }

    It 'the missing-key hint never offers AI_API_KEY for a non-gemini backend' {
        $Hints = InModuleScope AITriad -Parameters @{ Models = $script:Models } {
            param($Models)
            @($Models | Where-Object { $_.Backend -notin @('gemini', 'ollama') } | Group-Object Backend | ForEach-Object {
                [pscustomobject]@{ Backend = $_.Name; Hint = (Get-AIModelKeyStatus -Model $_.Group[0].Id -ApiKey '').EnvHint }
            })
        }
        @($Hints).Count | Should -BeGreaterThan 3
        foreach ($h in $Hints) {
            $h.Hint | Should -Not -Match '(^|[^A-Z_])AI_API_KEY' -Because "the '$($h.Backend)' hint must not offer the gemini-only fallback"
            $h.Hint | Should -Be $script:VarOf[$h.Backend]
        }
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
