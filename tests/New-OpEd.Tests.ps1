# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

Describe 'New-OpEd' -Tag 'oped' {
    BeforeAll {
        Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

        # Standard structured response the mocked backend returns.
        $script:GoodJson = @{
            headline      = 'Stop Stalling on AI Safety'
            subtitle      = 'The cost of delay is measured in trust'
            body_markdown = "First paragraph makes the case.`n`nSecond paragraph adds evidence."
            word_count    = 11
            pitch_email   = 'Subject: Op-Ed Submission: Stop Stalling on AI Safety'
        } | ConvertTo-Json
    }

    Context 'Happy path — topic input' {
        BeforeEach {
            $script:capturedSystem = $null
            $script:capturedPrompt = $null
            Mock Invoke-AIApi {
                $script:capturedSystem = $SystemInstruction
                $script:capturedPrompt = $Prompt
                [PSCustomObject]@{ Text = $script:GoodJson; Backend = 'gemini' }
            } -ModuleName AITriad
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

    Context 'URL input' {
        It 'Fetches and converts the URL into source material' {
            Mock Invoke-WebRequest { [PSCustomObject]@{ Content = '<html><body><p>Source body text.</p></body></html>' } } -ModuleName AITriad
            Mock ConvertFrom-Html { 'Source body text.' } -ModuleName AITriad
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

    Context 'Degradation and errors' {
        It 'Falls back to raw text when the response is not valid JSON' {
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = 'Just some prose, not JSON.'; Backend = 'gemini' } } -ModuleName AITriad
            $r = New-OpEd -Topic 'x' -Pov skeptic 3>$null
            $r.Body | Should -Match 'Just some prose'
        }

        It 'Throws an actionable error when the backend returns nothing' {
            Mock Invoke-AIApi { [PSCustomObject]@{ Text = ''; Backend = 'gemini' } } -ModuleName AITriad
            { New-OpEd -Topic 'x' -Pov skeptic } | Should -Throw
        }

        It 'Rejects an unknown POV at parameter binding' {
            { New-OpEd -Topic 'x' -Pov 'centrist' } | Should -Throw
        }
    }
}
