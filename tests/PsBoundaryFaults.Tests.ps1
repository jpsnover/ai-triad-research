# Tag: health (t/1163)  — see note on the second Describe for config tag
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    $script:ModulePath = Join-Path $script:RepoRoot 'scripts' 'AITriad' 'AITriad.psm1'
    $script:StubPath   = Join-Path $script:RepoRoot 'tests' 'fixtures' 'debate-cli-stub.ps1'
    Import-Module $script:ModulePath -Force -WarningAction SilentlyContinue
}

# ─────────────────────────────────────────────────────────────────────────────
# AC#1 — Structured ActionableError on stderr surfaces Goal/Problem/NextSteps
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Invoke-AITDebate surfaces structured ActionableError from CLI stderr (t/1163 AC#1)' -Tag 'health' {

    BeforeEach {
        $script:savedOverride = $env:AITRIAD_DEBATE_CLI_OVERRIDE
        $script:savedMode     = $env:AITRIAD_STUB_MODE
        $script:savedErrJson  = $env:AITRIAD_STUB_ERROR_JSON
        $env:AITRIAD_DEBATE_CLI_OVERRIDE = $script:StubPath
    }

    AfterEach {
        $env:AITRIAD_DEBATE_CLI_OVERRIDE = $script:savedOverride
        $env:AITRIAD_STUB_MODE           = $script:savedMode
        $env:AITRIAD_STUB_ERROR_JSON     = $script:savedErrJson
    }

    It 'Renders Goal / Problem / Location / Next Steps when stub emits a structured stderr line' {
        $env:AITRIAD_STUB_MODE = 'structured-stderr'
        $threw = $null
        try {
            Invoke-AITDebate -Topic 'stub topic' -Rounds 1 -ErrorAction Stop 6>$null 5>$null 4>$null *>&1 | Out-Null
        } catch { $threw = $_ }
        $threw | Should -Not -BeNullOrEmpty
        $msg = $threw.Exception.Message
        $msg | Should -Match '\[Debate CLI ActionableError\]'
        $msg | Should -Match 'Goal:\s+Run debate to completion'
        $msg | Should -Match 'Problem:\s+Stub CLI invoked'
        $msg | Should -Match 'Location:\s+lib/debate/cli\.ts:42'
        $msg | Should -Match 'Verify GEMINI_API_KEY is set'
        # And it must NOT be the raw JSON dump that the old code path produced
        $msg | Should -Not -Match '"goal":"Run debate to completion"'
    }

    It 'Falls back to the generic "Debate CLI failed" formatter when stderr has no structured error (regression guard)' {
        $env:AITRIAD_STUB_MODE = 'unstructured-stderr'
        $threw = $null
        try {
            Invoke-AITDebate -Topic 'stub topic' -Rounds 1 -ErrorAction Stop 6>$null 5>$null 4>$null *>&1 | Out-Null
        } catch { $threw = $_ }
        $threw | Should -Not -BeNullOrEmpty
        $msg = $threw.Exception.Message
        $msg | Should -Match 'Debate CLI failed with exit code 1'
        $msg | Should -Not -Match '\[Debate CLI ActionableError\]'
    }

    It 'Defensive: still surfaces a structured error when it lands on stdout instead of stderr' {
        $env:AITRIAD_STUB_MODE = 'structured-stdout'
        $threw = $null
        try {
            Invoke-AITDebate -Topic 'stub topic' -Rounds 1 -ErrorAction Stop 6>$null 5>$null 4>$null *>&1 | Out-Null
        } catch { $threw = $_ }
        $threw | Should -Not -BeNullOrEmpty
        $threw.Exception.Message | Should -Match '\[Debate CLI ActionableError\]'
        $threw.Exception.Message | Should -Match 'Run debate to completion'
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# AC#1 unit-level — Get-StructuredErrorFromStderr in isolation
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Get-StructuredErrorFromStderr (private helper)' -Tag 'health' {

    It 'Returns $null when the buffer is empty' {
        InModuleScope AITriad {
            (Get-StructuredErrorFromStderr -StderrLines @()) | Should -BeNullOrEmpty
        }
    }

    It 'Returns $null when no line is a JSON object with all four required keys' {
        InModuleScope AITriad {
            $lines = @(
                'plain log line',
                '{"goal":"missing other fields"}',
                'not json at all',
                ''
            )
            (Get-StructuredErrorFromStderr -StderrLines $lines) | Should -BeNullOrEmpty
        }
    }

    It 'Returns a normalized object when one line is a complete ActionableError' {
        InModuleScope AITriad {
            $lines = @(
                'unrelated prefix',
                '{"goal":"G","problem":"P","location":"L","next_steps":["a","b","c"]}',
                'unrelated suffix'
            )
            $r = Get-StructuredErrorFromStderr -StderrLines $lines
            $r          | Should -Not -BeNullOrEmpty
            $r.Goal     | Should -Be 'G'
            $r.Problem  | Should -Be 'P'
            $r.Location | Should -Be 'L'
            @($r.NextSteps).Count | Should -Be 3
            $r.NextSteps[1] | Should -Be 'b'
        }
    }

    It 'Coerces a single-string next_steps into an array' {
        InModuleScope AITriad {
            $line = '{"goal":"G","problem":"P","location":"L","next_steps":"just one"}'
            $r = Get-StructuredErrorFromStderr -StderrLines @($line)
            @($r.NextSteps).Count | Should -Be 1
            $r.NextSteps[0] | Should -Be 'just one'
        }
    }

    It 'Picks the NEWEST structured line when multiple are present' {
        InModuleScope AITriad {
            $lines = @(
                '{"goal":"old","problem":"P","location":"L","next_steps":["x"]}',
                'noise',
                '{"goal":"new","problem":"P","location":"L","next_steps":["y"]}'
            )
            (Get-StructuredErrorFromStderr -StderrLines $lines).Goal | Should -Be 'new'
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# AC#2 — Model ID validation is data-driven via ai-models.json registry
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Test-AIModelId is data-driven (t/1163 AC#2)' -Tag 'config' {

    It 'Accepts a model that exists in $script:ValidModelIds' {
        InModuleScope AITriad {
            $known = @($script:ValidModelIds) | Select-Object -First 1
            $known | Should -Not -BeNullOrEmpty
            Test-AIModelId $known | Should -Be $true
        }
    }

    It 'Rejects a clearly-fake model that is not in $script:ValidModelIds' {
        InModuleScope AITriad {
            { Test-AIModelId 'totally-fake-model-xyz-2099' } | Should -Throw -ExpectedMessage "*Invalid model*"
        }
    }

    It 'Accepts a NEW model the instant it is added to the registry — no code change needed' {
        InModuleScope AITriad {
            $synthetic = 'test-synthetic-model-2026'
            try {
                # Pre-condition: synthetic does not exist (validator throws)
                { Test-AIModelId $synthetic } | Should -Throw

                # Simulate ai-models.json gaining a new entry by mutating the
                # in-memory registry — Test-AIModelId must accept it without
                # any source change to the validator. This pins the contract
                # that validation is data-driven, not a hardcoded allowlist.
                $script:ValidModelIds = @($script:ValidModelIds) + $synthetic

                Test-AIModelId $synthetic | Should -Be $true
            } finally {
                $script:ValidModelIds = @(@($script:ValidModelIds) | Where-Object { $_ -ne $synthetic })
            }
        }
    }
}
