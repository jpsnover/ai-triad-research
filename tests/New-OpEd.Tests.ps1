# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

Describe 'New-OpEd' -Tag 'oped' {
    BeforeAll {
        Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

        # Essay call (has a SystemInstruction) returns this.
        $script:GoodJson = @{
            headline      = 'Stop Stalling on AI Safety'
            subtitle      = 'The cost of delay is measured in trust'
            body_markdown = "First paragraph makes the case.`n`nSecond paragraph adds evidence."
            word_count    = 11
            pitch_email   = 'Subject: Op-Ed Submission: Stop Stalling on AI Safety'
        } | ConvertTo-Json

        # Reflection call (no SystemInstruction) returns this. Deliberately reports
        # 2 of the 3 mock ids (omits saf-intentions-004) to exercise the fallback.
        $script:ReflJson = @{
            grounding_usage = @(
                @{ id = 'saf-beliefs-001'; reflection = 'Anchors the thesis in the second paragraph.' }
                @{ id = 'sit-012'; reflection = 'Opens the lede as the concrete scene.' }
            )
        } | ConvertTo-Json -Depth 5

        # Branching backend mock: the essay call carries a SystemInstruction, the
        # reflection call does not. Captures only the essay prompt/system so the
        # second call doesn't clobber assertions.
        $script:MockAI = {
            if ($SystemInstruction) {
                $script:capturedSystem = $SystemInstruction
                $script:capturedPrompt = $Prompt
                [PSCustomObject]@{ Text = $script:GoodJson; Backend = 'gemini' }
            } else {
                $script:capturedReflPrompt = $Prompt
                [PSCustomObject]@{ Text = $script:ReflJson; Backend = 'gemini' }
            }
        }

        # Fixture the mocked retriever returns: 2 safetyist BDI nodes + 1 situation.
        $script:MockNodes = @(
            [PSCustomObject]@{ Id = 'saf-beliefs-001'; POV = 'safetyist'; Category = 'Beliefs';    Label = 'Irreversibility demands caution'; Description = 'Some harms cannot be undone.'; Score = 0.71 }
            [PSCustomObject]@{ Id = 'saf-intentions-004'; POV = 'safetyist'; Category = 'Intentions'; Label = 'Mandate pre-deployment audits'; Description = 'Independent audits before release.'; Score = 0.66 }
            [PSCustomObject]@{ Id = 'sit-012'; POV = 'situations'; Category = 'Situations'; Label = 'Undetected jailbreak at scale'; Description = 'A model bypasses filters post-release.'; Score = 0.58 }
        )
    }

    Context 'Happy path — topic input' {
        BeforeEach {
            $script:capturedSystem = $null
            $script:capturedPrompt = $null
            Mock Invoke-AIApi -MockWith $script:MockAI -ModuleName AITriad
            # Mock retrieval so existing tests never touch the data repo / Python.
            Mock Get-RelevantTaxonomyNodes { $script:MockNodes } -ModuleName AITriad
        }

        It 'Returns a populated structured object' {
            $r = New-OpEd -Topic 'Pre-deployment audits for frontier models' -Pov safetyist
            $r.Headline  | Should -Be 'Stop Stalling on AI Safety'
            $r.Subtitle  | Should -Match 'trust'
            $r.Body      | Should -Match 'First paragraph'
            $r.Pov       | Should -Be 'safetyist'
            $r.Outlet    | Should -Be 'Generic'
            $r.Backend   | Should -Be 'gemini'
        }

        It 'Counts the actual body words rather than trusting the model self-report' {
            $r = New-OpEd -Topic 'x' -Pov skeptic
            # Body has 9 whitespace-separated words; model claimed 11.
            $r.WordCount | Should -Be 9
        }

        It 'Injects the Soul-document voice into the system prompt' {
            New-OpEd -Topic 'x' -Pov accelerationist | Out-Null
            $script:capturedSystem | Should -Match 'VALUE HIERARCHY'
            $script:capturedSystem | Should -Match 'ANTI-PATTERNS'
            # Accelerationist personality string from the Soul doc.
            $script:capturedSystem | Should -Match 'forward-looking'
        }

        It 'Derives the target word count from the outlet band' {
            New-OpEd -Topic 'x' -Pov safetyist -Outlet ForeignAffairs | Out-Null
            $script:capturedPrompt | Should -Match '1200 words'
        }

        It 'Lets an explicit -WordCount override the outlet band' {
            New-OpEd -Topic 'x' -Pov safetyist -Outlet ForeignAffairs -WordCount 500 | Out-Null
            $script:capturedPrompt | Should -Match '500 words'
        }

        It 'Normalizes short-form POV aliases to the canonical name' {
            (New-OpEd -Topic 'x' -Pov acc).Pov | Should -Be 'accelerationist'
            (New-OpEd -Topic 'x' -Pov saf).Pov | Should -Be 'safetyist'
            (New-OpEd -Topic 'x' -Pov skp).Pov | Should -Be 'skeptic'
        }

        It 'Emits a pitch email only when -IncludePitch is set' {
            (New-OpEd -Topic 'x' -Pov skeptic).Pitch                 | Should -BeNullOrEmpty
            (New-OpEd -Topic 'x' -Pov skeptic -IncludePitch).Pitch   | Should -Match 'Op-Ed Submission'
        }

        It 'Writes a Markdown file when -OutputPath is supplied' {
            $out = Join-Path ([System.IO.Path]::GetTempPath()) "oped-$([guid]::NewGuid()).md"
            try {
                New-OpEd -Topic 'x' -Pov safetyist -OutputPath $out | Out-Null
                Test-Path $out | Should -BeTrue
                (Get-Content -Raw $out) | Should -Match '# Stop Stalling on AI Safety'
            } finally {
                Remove-Item $out -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Context 'Taxonomy grounding' {
        BeforeEach {
            $script:capturedPrompt = $null
            $script:capturedReflPrompt = $null
            Mock Invoke-AIApi -MockWith $script:MockAI -ModuleName AITriad
        }

        It 'Surfaces the injected elements and their relevance scores on Grounding' {
            Mock Get-RelevantTaxonomyNodes { $script:MockNodes } -ModuleName AITriad
            $r = New-OpEd -Topic 'pre-deployment audits' -Pov safetyist
            @($r.Grounding).Count | Should -Be 3
            $bdi = @($r.Grounding | Where-Object Type -eq 'bdi')
            $sit = @($r.Grounding | Where-Object Type -eq 'situation')
            $bdi.Count | Should -Be 2
            $sit.Count | Should -Be 1
            ($r.Grounding | Where-Object Id -eq 'saf-beliefs-001').RelevanceScore | Should -Be 0.71
            ($r.Grounding | Where-Object Id -eq 'sit-012').Category | Should -Be 'Situation'
        }

        It 'Injects the retrieved node text (with ids) into the user prompt' {
            Mock Get-RelevantTaxonomyNodes { $script:MockNodes } -ModuleName AITriad
            New-OpEd -Topic 'audits' -Pov safetyist | Out-Null
            $script:capturedPrompt | Should -Match 'Irreversibility demands caution'
            $script:capturedPrompt | Should -Match 'Undetected jailbreak at scale'
            $script:capturedPrompt | Should -Match 'REGISTERED POSITIONS'
            # The id is prefixed so the model can reference it in grounding_usage.
            $script:capturedPrompt | Should -Match '\[saf-beliefs-001\]'
        }

        It 'Joins the model grounding_usage back onto each element as Reflection' {
            Mock Get-RelevantTaxonomyNodes { $script:MockNodes } -ModuleName AITriad
            $r = New-OpEd -Topic 'audits' -Pov safetyist
            ($r.Grounding | Where-Object Id -eq 'saf-beliefs-001').Reflection | Should -Match 'thesis'
            ($r.Grounding | Where-Object Id -eq 'sit-012').Reflection        | Should -Match 'lede'
            # saf-intentions-004 was not in grounding_usage → explicit fallback.
            ($r.Grounding | Where-Object Id -eq 'saf-intentions-004').Reflection | Should -Be '(not reported)'
        }

        It 'Filters retrieved nodes to the requested POV' {
            # Retriever returns a mix; a foreign-POV node must not be injected.
            Mock Get-RelevantTaxonomyNodes {
                $script:MockNodes + [PSCustomObject]@{ Id = 'acc-beliefs-009'; POV = 'accelerationist'; Category = 'Beliefs'; Label = 'Permissionless innovation'; Description = 'x'; Score = 0.9 }
            } -ModuleName AITriad
            $r = New-OpEd -Topic 'audits' -Pov safetyist
            @($r.Grounding | Where-Object Id -eq 'acc-beliefs-009').Count | Should -Be 0
        }

        It '-VoiceOnly skips retrieval and returns empty Grounding' {
            Mock Get-RelevantTaxonomyNodes { $script:MockNodes } -ModuleName AITriad
            $r = New-OpEd -Topic 'x' -Pov safetyist -VoiceOnly
            @($r.Grounding).Count | Should -Be 0
            Should -Invoke Get-RelevantTaxonomyNodes -ModuleName AITriad -Times 0
        }

        It 'Zeroed counts disable retrieval entirely' {
            Mock Get-RelevantTaxonomyNodes { $script:MockNodes } -ModuleName AITriad
            New-OpEd -Topic 'x' -Pov safetyist -MaxGroundingNodes 0 -MaxSituations 0 | Out-Null
            Should -Invoke Get-RelevantTaxonomyNodes -ModuleName AITriad -Times 0
        }

        It 'Degrades to voice-only when retrieval fails' {
            Mock Get-RelevantTaxonomyNodes { throw 'embeddings.json not found' } -ModuleName AITriad
            $r = New-OpEd -Topic 'x' -Pov safetyist 3>$null
            $r.Body | Should -Match 'First paragraph'
            @($r.Grounding).Count | Should -Be 0
        }
    }

    Context 'URL input' {
        It 'Fetches and converts the URL into source material' {
            Mock Invoke-WebRequest { [PSCustomObject]@{
                Content    = '<html><body><p>Source body text.</p></body></html>'
                Headers    = @{ 'Content-Type' = 'text/html; charset=utf-8' }
                StatusCode = 200
            } } -ModuleName AITriad
            # 35 alpha words per sentence × 3 = 105 — passes the MinReadableWords=100
            # gate; "Source body text" preserved for the seenPrompt assertion.
            Mock ConvertFrom-Html {
                $s = 'Source body text. Artificial intelligence governance policy requires careful consideration of competing interests including innovation safety fairness accountability transparency democratic oversight regulation compliance monitoring evaluation auditing enforcement remediation capacity building standards development international coordination multistakeholder approaches.'
                "$s $s $s"
            } -ModuleName AITriad
            Mock Get-RelevantTaxonomyNodes { @() } -ModuleName AITriad
            $script:seenPrompt = $null
            Mock Invoke-AIApi {
                $script:seenPrompt = $Prompt
                [PSCustomObject]@{ Text = $script:GoodJson; Backend = 'gemini' }
            } -ModuleName AITriad

            $r = New-OpEd -Url 'https://example.com/article' -Pov accelerationist
            $r.Headline | Should -Be 'Stop Stalling on AI Safety'
            $script:seenPrompt | Should -Match 'Source body text'
            Should -Invoke Invoke-WebRequest -ModuleName AITriad -Times 1
        }
    }

    Context 'FromPrep parameter set' {
        BeforeEach {
            $script:capturedSystem = $null
            $script:capturedPrompt = $null
            Mock Invoke-AIApi -MockWith $script:MockAI -ModuleName AITriad
            Mock Get-RelevantTaxonomyNodes { @() } -ModuleName AITriad
        }

        # Regression: t/2588 — -Topic was missing [Parameter(ParameterSetName='FromPrep')]
        # so passing both -SourcePrep and -Topic together threw "parameter set cannot be resolved".
        It 'Resolves FromPrep without error when both -SourcePrep and -Topic are passed' {
            $Prep = [PSCustomObject]@{
                Url                  = 'https://example.com/doc.pdf'
                SourceMarkdown       = 'Artificial intelligence policy requires oversight and accountability mechanisms.'
                SourceFormat         = 'pdf'
                SourceExtractionTool = 'ConvertFrom-Pdf'
                ReadableWords        = 12
                ReadableRatio        = 0.92
                SourceBrief          = [PSCustomObject]@{ thesis = 'AI needs oversight.'; readable = 'true' }
            }
            { New-OpEd -SourcePrep $Prep -Topic 'Explicit topic override' -Pov safetyist } |
                Should -Not -Throw
        }

        It 'Uses SourcePrep.SourceMarkdown as the source material in the prompt' {
            $Prep = [PSCustomObject]@{
                Url                  = 'https://example.com/doc.pdf'
                SourceMarkdown       = 'Unique source content marker for test assertion.'
                SourceFormat         = 'pdf'
                SourceExtractionTool = 'ConvertFrom-Pdf'
                ReadableWords        = 8
                ReadableRatio        = 0.88
                SourceBrief          = [PSCustomObject]@{ thesis = 'test'; readable = 'true' }
            }
            New-OpEd -SourcePrep $Prep -Topic 'Explicit topic' -Pov safetyist | Out-Null
            $script:capturedPrompt | Should -Match 'Unique source content marker'
        }
    }

    Context 'Degradation and errors' {
        # These exercise response handling, not grounding — run voice-only so no
        # retrieval subprocess is attempted.
        It 'Falls back to raw text when the response is not valid JSON' {
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = 'Just some prose, not JSON.'; Backend = 'gemini' } } -ModuleName AITriad
            $r = New-OpEd -Topic 'x' -Pov skeptic -VoiceOnly 3>$null
            $r.Body | Should -Match 'Just some prose'
        }

        It 'Throws an actionable error when the backend returns nothing' {
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = ''; Backend = 'gemini' } } -ModuleName AITriad
            { New-OpEd -Topic 'x' -Pov skeptic -VoiceOnly } | Should -Throw
        }

        It 'Rejects an unknown POV at parameter binding' {
            { New-OpEd -Topic 'x' -Pov 'centrist' } | Should -Throw
        }
    }
}
