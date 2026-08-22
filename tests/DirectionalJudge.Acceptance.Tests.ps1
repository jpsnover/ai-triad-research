# Tag: live-ai (t/2900)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    FULL two-stage acceptance harness for the t/2900 polarity gate — the committed
    evidence CL asked for (t/2900#12/#16). Runs the REAL deberta engine (stage 1) AND
    the real gemini-3.1-pro-preview judge (stage 2) on the golden arms, using the
    gate-exact node_prop builder (Get-NodePropText) and the REAL incident key_points.
.DESCRIPTION
    Per arm, mirrors the gate exactly:
      1. deberta OPPOSES-IF-ANY over the full rep set {verbatim, canonical} via the
         gate-exact node_prop. ASSERT at least one rep opposes — else FAIL LOUD (the
         "no vacuous arm" guard, specialized to the multi-rep reality, CL t/2900#16:
         acc-047 flags only on verbatim, canonical→agrees; a future text/rep change
         that silently stops an arm from flagging must break this test, not pass it).
      2. The judge disposes the flagged candidate at temp 0.3, N draws, unanimity:
         MUST-NOT-FLIP arms → judge must NOT return 'opposes' (KEEP);
         MUST-FLIP arms     → judge must return 'opposes'.

    Golden arms use the REAL demoted key_points recovered from
    summaries/ai-doesnt-rewrite-privacy-law-...json (t/2896 revert 128ce8f4) — NOT
    paraphrases (the earlier paraphrase did not reproduce, CL t/2900#12/#15).

    Node text comes from the LIVE taxonomy (AI_TRIAD_DATA_ROOT) so node_prop is
    byte-identical to production. deberta is local; the judge needs GEMINI_API_KEY,
    so the suite is tagged 'live-ai' and skips without a key (run for GV).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    if (-not $env:AI_TRIAD_DATA_ROOT -and (Test-Path 'C:\Users\jsnov\repos\ai-triad-data')) {
        $env:AI_TRIAD_DATA_ROOT = 'C:\Users\jsnov\repos\ai-triad-data'
    }
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    $script:NoKey = [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY) -and [string]::IsNullOrWhiteSpace($env:AI_API_KEY)
}

BeforeDiscovery {
    # REAL incident key_points (recovered t/2896). Each arm carries BOTH reps so the
    # harness runs deberta opposes-if-any over the full set.
    $antiExceptVerbatim  = 'AI presents new privacy challenges, but treating AI as if it lives outside the parameters of ordinary privacy law is fallacious. The emerging lesson from privacy regulators and enforcers is increasingly clear: there is no AI exceptionalism. The same principles that have long governed responsible data use still apply.'
    $antiExceptCanonical = 'Existing legal frameworks govern AI without requiring entirely new statutes.'
    $script:Arms = @(
        @{ Name = 'case_4 agency→loss vs saf-017 (KEEP)'; MustFlip = $false; NodeId = 'saf-beliefs-017'; Camp = 'safetyist'
           Reps = @(
             'AI infers, summarizes, remembers, ranks, and increasingly acts across blurred boundaries and in a non-determistic manner. That shifts AI into a category closer to delegated action. And this delegated action relationship creates a different risk profile and attack surface for privacy harms.',
             'AI deployment speed and agentic autonomy erode organizational visibility and control over data.') }
        @{ Name = 'case_5a anti-exceptionalism vs acc-127 matching (KEEP)'; MustFlip = $false; NodeId = 'acc-intentions-127'; Camp = 'accelerationist'
           Reps = @($antiExceptVerbatim, $antiExceptCanonical) }
        @{ Name = 'case_5b anti-exceptionalism vs acc-047 opposite (FLIP)'; MustFlip = $true; NodeId = 'acc-intentions-047'; Camp = 'accelerationist'
           Reps = @($antiExceptVerbatim, $antiExceptCanonical) }
        @{ Name = 'case_1 t/2742 inversion vs acc-047 (FLIP)'; MustFlip = $true; NodeId = 'acc-intentions-047'; Camp = 'accelerationist'
           Reps = @('AI presents new privacy challenges, but treating AI as if it lives outside the parameters of ordinary privacy law is fallacious. There is no AI exceptionalism; the same principles that have long governed responsible data use still apply. What changes is where those principles need to be built.',
                    $antiExceptCanonical) }
    )
}

Describe 'Polarity gate full two-stage acceptance (t/2900, live)' -Tag 'live-ai' {

    It 'stage-1 fires (opposes-if-any) AND stage-2 disposes correctly: <Name>' -ForEach $script:Arms {
        if ($script:NoKey) { Set-ItResult -Skipped -Because 'no GEMINI_API_KEY — judge unavailable (run for GV)'; return }

        $result = InModuleScope AITriad -Parameters @{ NodeId = $NodeId; Reps = $Reps; Camp = $Camp } {
            param($NodeId, $Reps, $Camp)
            $node = $null
            foreach ($pov in $script:TaxonomyData.Values) {
                if (-not $pov.PSObject.Properties['nodes']) { continue }
                $node = @($pov.nodes) | Where-Object { $_.PSObject.Properties['id'] -and $_.id -eq $NodeId } | Select-Object -First 1
                if ($node) { break }
            }
            if (-not $node) { throw "node $NodeId not found in taxonomy (check AI_TRIAD_DATA_ROOT)" }
            $nodeProp = Get-NodePropText -Node $node

            # Stage 1: deberta opposes-if-any over the full rep set (gate-exact node_prop).
            $pairs = for ($i = 0; $i -lt $Reps.Count; $i++) {
                [PSCustomObject]@{ Id = $i; ClaimProp = $Reps[$i]; NodeProp = $nodeProp; ClaimPov = $Camp; NodePov = $Camp }
            }
            $verdicts = Test-DirectionalAgreement -Pair @($pairs) -TauContra 1.0
            $opposing = @($verdicts | Where-Object { [string]$_.Direction -eq 'opposes' })

            $judged = $null
            if ($opposing.Count -gt 0) {
                $claim = [string]($pairs | Where-Object { $_.Id -eq $opposing[0].Id }).ClaimProp
                $judged = Invoke-DirectionalJudge -Claim $claim -NodeProp $nodeProp -Camp $Camp -Temperature 0.3 -Draws 3
            }
            [PSCustomObject]@{ DebertaOpposingReps = $opposing.Count; Judged = $judged }
        }

        # No-vacuous-arm guard: deberta MUST flag at least one rep, or the arm proves nothing.
        $result.DebertaOpposingReps | Should -BeGreaterThan 0 -Because "$Name — deberta must flag a candidate over the rep set; if none do, the arm is vacuous (text/rep drift) and the test must fail loudly"

        if ($MustFlip) {
            $result.Judged | Should -Be 'opposes' -Because "$Name — genuine inversion: the judge must unanimously confirm the flip"
        } else {
            $result.Judged | Should -Not -Be 'opposes' -Because "$Name — genuine agreement: the judge must NOT confirm a flip (KEEP the deberta false-positive)"
        }
    }
}
