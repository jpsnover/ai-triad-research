# Tag: enrichment (t/2530)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    L1 regression (t/2530): the Gemini API key must travel in the x-goog-api-key
    header, never as a ?key= URL query parameter (which leaks via proxy logs and
    PS5.1 error-record URIs). Covers both PowerShell Gemini call sites in
    AIEnrich.psm1 — Invoke-AIApi generateContent and Measure-PromptTokens
    countTokens. Keyless (HTTP fully mocked) — always runs.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AIEnrich.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Gemini key in x-goog-api-key header, not ?key= URL (t/2530 L1)' -Tag 'enrichment' {

    It 'Invoke-AIApi (generateContent): no key= in URL, key in header' {
        $mockResponse = [PSCustomObject]@{
            candidates    = @([PSCustomObject]@{
                finishReason = 'STOP'
                content      = [PSCustomObject]@{ parts = @([PSCustomObject]@{ text = 'ok' }) }
            })
            usageMetadata = [PSCustomObject]@{ promptTokenCount = 1; candidatesTokenCount = 1; totalTokenCount = 2 }
        }
        Mock Invoke-RestMethod { $mockResponse } -ModuleName AIEnrich

        $null = Invoke-AIApi -Prompt 'test' -Model 'gemini-3.5-flash-lite' -ApiKey 'fake-key-123' 3>$null

        Should -Invoke Invoke-RestMethod -ModuleName AIEnrich -Times 1 -Exactly -ParameterFilter {
            $Uri -notmatch 'key=' -and $Headers['x-goog-api-key'] -eq 'fake-key-123'
        }
    }

    It 'Measure-PromptTokens (countTokens): no key= in URL, key in header' {
        Mock Invoke-RestMethod { [PSCustomObject]@{ totalTokens = 5 } } -ModuleName AIEnrich

        $null = Measure-PromptTokens -Text 'hello world' -ApiKey 'fake-key-123'

        Should -Invoke Invoke-RestMethod -ModuleName AIEnrich -Times 1 -Exactly -ParameterFilter {
            $Uri -notmatch 'key=' -and $Headers['x-goog-api-key'] -eq 'fake-key-123'
        }
    }
}
