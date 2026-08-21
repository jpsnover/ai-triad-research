# Tag: live-ai (t/2900)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    LIVE acceptance harness for the t/2900 directional LLM-judge (Invoke-DirectionalJudge)
    — asserts UNANIMOUS 4/4 on the golden arms at temp 0.3, the exact rule production
    enforces (TL GV t/2900#7). Calls the real gemini-3.1-pro-preview.
.DESCRIPTION
    Golden arms (research/comp-linguist/fixtures/stance-polarity-repro.json, CL t/2900#1):
      MUST-NOT-FLIP (judge must NOT return 'opposes'):
        - case_4  : agency→loss claim vs saf-beliefs-017 (deberta false-opposes @7.51)
        - case_5a : anti-exceptionalism claim vs acc-intentions-127 matching pole (@1.61)
      MUST-FLIP (judge MUST return 'opposes'):
        - case_5b : anti-exceptionalism claim vs acc-intentions-047 opposite pole (@4.91)
        - case_1  : t/2742 anti-exceptionalism inversion vs acc-intentions-047

    deberta returns 'opposes' on ALL FOUR (it can't discriminate the poles); the judge
    must separate them. Tagged 'live-ai' + auto-skipped without GEMINI_API_KEY so it runs
    for Gate Verification but never blocks CI (mirrors the xai live-round-trip test).
    Since Invoke-DirectionalJudge only returns 'opposes' on UNANIMOUS draws, asserting the
    per-arm direction across N draws IS the unanimous-4/4 acceptance.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    $script:NoKey = [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY) -and [string]::IsNullOrWhiteSpace($env:AI_API_KEY)
}

# Golden arms — defined at DISCOVERY time (top-level) so `It -ForEach` can see them.
# node_prop = 'label — Core', built as the gate builds it (Encompasses/Excludes stripped).
BeforeDiscovery {
    $antiExcept = 'Treating artificial intelligence as exempt from ordinary privacy law is fallacious because established data protection principles continue to govern responsible use.'
    $script:Arms = @(
        @{ Name = 'case_4 agency→loss vs saf-017'; MustFlip = $false; Camp = 'safetyist'
           Claim = 'AI systems ingest and act across blurred data boundaries through delegated action, expanding the attack surface and eroding organizational visibility and control.'
           NodeProp = 'AI Deployment Speed Erodes Organizational Visibility and Control — A Belief within safetyist discourse that describes how the rapid adoption of AI systems undermines security governance by creating a systemic loss of visibility and control over data.' }
        @{ Name = 'case_5a anti-exceptionalism vs acc-127 (matching)'; MustFlip = $false; Camp = 'accelerationist'
           Claim = $antiExcept
           NodeProp = 'Argue That Existing Laws Already Govern AI, Requiring No New AI-Specific Statutes — An Intention within accelerationist discourse that asserts AI is not legally exceptional; existing technology-neutral bodies of law already reach AI, so bespoke AI-specific legislation is unnecessary.' }
        @{ Name = 'case_5b anti-exceptionalism vs acc-047 (opposite)'; MustFlip = $true; Camp = 'accelerationist'
           Claim = $antiExcept
           NodeProp = 'Argue That AI Requires Entirely New Laws, Not Adapted Old Ones — An Intention within accelerationist discourse that asserts emerging technologies are so transformative they require entirely new legal frameworks rather than adapted existing laws.' }
        @{ Name = 'case_1 t/2742 inversion vs acc-047'; MustFlip = $true; Camp = 'accelerationist'
           Claim = 'AI presents new privacy challenges, but treating AI as if it lives outside the parameters of ordinary privacy law is fallacious. There is no AI exceptionalism; the same principles that have long governed responsible data use still apply.'
           NodeProp = 'Argue That AI Requires Entirely New Laws, Not Adapted Old Ones — An Intention within accelerationist discourse that asserts emerging technologies are so transformative they require entirely new legal frameworks rather than adapted existing laws.' }
    )
}

Describe 'Directional LLM-judge acceptance — UNANIMOUS 4/4 @ temp 0.3 (t/2900, live)' -Tag 'live-ai' {

    It 'separates all four golden arms (deberta cannot): <Name>' -ForEach $script:Arms {
        if ($script:NoKey) { Set-ItResult -Skipped -Because 'no GEMINI_API_KEY — live judge unavailable (run for GV)'; return }

        $verdict = InModuleScope AITriad -Parameters @{ Claim = $Claim; NodeProp = $NodeProp; Camp = $Camp } {
            param($Claim, $NodeProp, $Camp)
            Invoke-DirectionalJudge -Claim $Claim -NodeProp $NodeProp -Camp $Camp -Temperature 0.3 -Draws 3
        }

        if ($MustFlip) {
            $verdict | Should -Be 'opposes' -Because "$Name is a genuine inversion — the judge must unanimously confirm the flip"
        } else {
            $verdict | Should -Not -Be 'opposes' -Because "$Name is a genuine agreement — the judge must NOT confirm a flip (KEEP)"
        }
    }
}
