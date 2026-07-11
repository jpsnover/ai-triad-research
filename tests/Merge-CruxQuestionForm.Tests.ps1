# Tag: enrichment (t/1509)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Merge-CruxQuestionForm (t/1509) — the preserve+generate helper that
    stops Export-AggregatedCruxes from clobbering the t/1507 question_form merge.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-CruxQuestionForm validation' -Tag 'enrichment' {
    It 'Accepts a well-formed question' {
        InModuleScope AITriad {
            Test-CruxQuestionForm -Question 'Should frontier AI labs be required to run red-team evaluations before deployment?' | Should -BeTrue
        }
    }
    It 'Rejects empty / whitespace input' {
        InModuleScope AITriad {
            Test-CruxQuestionForm -Question ''    | Should -BeFalse
            Test-CruxQuestionForm -Question '   ' | Should -BeFalse
        }
    }
    It 'Rejects strings not ending with ?' {
        InModuleScope AITriad {
            Test-CruxQuestionForm -Question 'AI is dangerous.' | Should -BeFalse
        }
    }
    It 'Rejects multi-question strings' {
        InModuleScope AITriad {
            Test-CruxQuestionForm -Question 'Is AI dangerous? Should we regulate it?' | Should -BeFalse
        }
    }
    It 'Rejects strings over 45 words' {
        InModuleScope AITriad {
            $long = (1..50 | ForEach-Object { 'word' }) -join ' '
            Test-CruxQuestionForm -Question ($long + '?') | Should -BeFalse
        }
    }
}

Describe 'Merge-CruxQuestionForm preserve+generate (t/1509)' -Tag 'enrichment' {

    BeforeEach {
        $script:PrevPath = Join-Path ([System.IO.Path]::GetTempPath()) ("aggcx-prev-{0}.json" -f ([guid]::NewGuid().ToString('N')))
    }
    AfterEach {
        if (Test-Path $script:PrevPath) { Remove-Item $script:PrevPath -Force -ErrorAction SilentlyContinue }
    }

    It 'Preserves existing question_form by crux id (round-trip)' {
        # Seed a "previous export" with two cruxes carrying question_form.
        $prev = [ordered]@{
            generated_at = '2026-05-08T00:00:00Z'
            total_cruxes = 2
            cruxes = @(
                [ordered]@{
                    id            = 'crux-001'
                    statement     = 'Insurance-underwritten risk assessment forces model-weight disclosure.'
                    type          = 'empirical'
                    question_form = 'Can insurers reliably detect AI model failure modes through risk-assessment processes?'
                },
                [ordered]@{
                    id            = 'crux-002'
                    statement     = 'Existential risk from advanced AI is meaningful.'
                    type          = 'empirical'
                    question_form = 'What is the probability that advanced AI systems will cause human extinction?'
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        # Simulated fresh aggregate — same ids/statements but NO question_form yet.
        $fresh = @(
            [ordered]@{ id = 'crux-001'; statement = $prev.cruxes[0].statement; type = 'empirical' }
            [ordered]@{ id = 'crux-002'; statement = $prev.cruxes[1].statement; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            # Must NOT call Invoke-AIByUsage when everything is preservable.
            Mock Invoke-AIByUsage { throw 'must not be called — everything should preserve' } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Preserved | Should -Be 2
            $stats.Generated | Should -Be 0
            $stats.Failed    | Should -Be 0
            $Fresh[0]['question_form'] | Should -Be 'Can insurers reliably detect AI model failure modes through risk-assessment processes?'
            $Fresh[1]['question_form'] | Should -Be 'What is the probability that advanced AI systems will cause human extinction?'
            Should -Invoke Invoke-AIByUsage -ModuleName AITriad -Times 0
        }
    }

    It 'Generates question_form for new cruxes via the UsageID' {
        # Empty previous file — nothing to preserve.
        ([ordered]@{ cruxes = @() }) | ConvertTo-Json | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-042'; statement = 'Alignment research generalizes across model scales.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            Mock Invoke-AIByUsage {
                [PSCustomObject]@{
                    Text = '{"question":"Does alignment research generalize across model scales?"}'
                }
            } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Generated | Should -Be 1
            $stats.Preserved | Should -Be 0
            $stats.Failed    | Should -Be 0
            $Fresh[0]['question_form'] | Should -Be 'Does alignment research generalize across model scales?'
            Should -Invoke Invoke-AIByUsage -ModuleName AITriad -Times 1 -ParameterFilter { $UsageId -eq 'enrichment.crux-question-form' }
        }
    }

    It 'Strips json code fences from the AI response before parsing' {
        ([ordered]@{ cruxes = @() }) | ConvertTo-Json | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-100'; statement = 'Regulation slows innovation.'; type = 'values' }
        )
        $fencedText = @'
```json
{"question":"Does regulation slow AI innovation?"}
```
'@

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath; Fenced = $fencedText } {
            param($Fresh, $PrevPath, $Fenced)
            Mock Invoke-AIByUsage {
                [PSCustomObject]@{ Text = $Fenced }
            } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Generated | Should -Be 1
            $Fresh[0]['question_form'] | Should -Be 'Does regulation slow AI innovation?'
        }
    }

    It 'Leaves question_form absent when validation fails (does not write invalid text)' {
        ([ordered]@{ cruxes = @() }) | ConvertTo-Json | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-999'; statement = 'A crux.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            # Response missing '?' → Test-CruxQuestionForm rejects.
            Mock Invoke-AIByUsage {
                [PSCustomObject]@{ Text = '{"question":"This is a statement, not a question."}' }
            } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Failed    | Should -Be 1
            $stats.Generated | Should -Be 0
            $Fresh[0].Contains('question_form') | Should -BeFalse
        }
    }

    It 'Leaves question_form absent when the UsageID call throws' {
        ([ordered]@{ cruxes = @() }) | ConvertTo-Json | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{ id = 'crux-500'; statement = 'A crux.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            Mock Invoke-AIByUsage { throw 'backend unavailable' } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Failed | Should -Be 1
            $Fresh[0].Contains('question_form') | Should -BeFalse
        }
    }

    It 'Falls through to regeneration when the id matches but the statement changed (t/1509 CL guard)' {
        # Previous export has id=crux-050 with statement A; fresh aggregate has
        # id=crux-050 but a materially different statement — dedup clustering
        # re-assigned the slot. Preservation must NOT ride the old question_form
        # along; it must call the AI to generate a fresh one.
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id            = 'crux-050'
                    statement     = 'AI capability progress will slow after 2027.'
                    type          = 'empirical'
                    question_form = 'Will AI capability progress slow after 2027?'
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{
                id        = 'crux-050'
                statement = 'Open-weight releases increase misuse risk more than they aid defense.'
                type      = 'empirical'
            }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            Mock Invoke-AIByUsage {
                [PSCustomObject]@{ Text = '{"question":"Do open-weight releases increase misuse risk more than they aid defense?"}' }
            } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Preserved | Should -Be 0
            $stats.Generated | Should -Be 1
            $stats.Failed    | Should -Be 0
            $Fresh[0]['question_form'] | Should -Be 'Do open-weight releases increase misuse risk more than they aid defense?'
            $Fresh[0]['question_form'] | Should -Not -Be 'Will AI capability progress slow after 2027?'
            Should -Invoke Invoke-AIByUsage -ModuleName AITriad -Times 1
        }
    }

    It 'Preserves when statement matches after trim-only whitespace differences' {
        # Guard is Trim-normalized: leading/trailing whitespace shouldn't force regeneration.
        $prev = [ordered]@{
            cruxes = @(
                [ordered]@{
                    id            = 'crux-060'
                    statement     = 'Compute governance is feasible.'
                    type          = 'values'
                    question_form = 'Is compute governance feasible?'
                }
            )
        }
        $prev | ConvertTo-Json -Depth 6 | Set-Content -Path $script:PrevPath -Encoding utf8NoBOM

        $fresh = @(
            [ordered]@{
                id        = 'crux-060'
                statement = "  Compute governance is feasible.`n"
                type      = 'values'
            }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            Mock Invoke-AIByUsage { throw 'whitespace-only diff must not trigger regeneration' } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Preserved | Should -Be 1
            $stats.Generated | Should -Be 0
            $Fresh[0]['question_form'] | Should -Be 'Is compute governance feasible?'
            Should -Invoke Invoke-AIByUsage -ModuleName AITriad -Times 0
        }
    }

    It 'Handles a missing previous file (fresh install) — generates for every crux' {
        # PrevPath does not exist.
        $fresh = @(
            [ordered]@{ id = 'crux-001'; statement = 'Something.'; type = 'empirical' }
        )

        InModuleScope AITriad -Parameters @{ Fresh = $fresh; PrevPath = $script:PrevPath } {
            param($Fresh, $PrevPath)
            Mock Invoke-AIByUsage {
                [PSCustomObject]@{ Text = '{"question":"Is something the case?"}' }
            } -ModuleName AITriad

            $stats = Merge-CruxQuestionForm -Cruxes $Fresh -PreviousPath $PrevPath

            $stats.Preserved | Should -Be 0
            $stats.Generated | Should -Be 1
            $Fresh[0]['question_form'] | Should -Be 'Is something the case?'
        }
    }
}
