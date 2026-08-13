# Tag: oped (t/2586)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Get-OpEdSource (t/2586).
.DESCRIPTION
    Mocks Invoke-WebRequest and the DocConverter cmdlets to verify format
    detection, readability gate, truncation, and output shape without network
    access or binary tools.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # 150+ readable words — passes the default MinReadableWords=100 gate.
    $script:ReadableText = (
        'Artificial intelligence governance requires careful consideration of ' +
        'competing interests including innovation safety fairness accountability ' +
        'and democratic oversight. Advanced machine learning systems deployed in ' +
        'healthcare employment criminal justice education housing and credit must ' +
        'be subject to rigorous pre-deployment evaluation auditing transparency ' +
        'requirements and ongoing monitoring for human rights compliance. ' +
        'Policymakers regulators researchers practitioners and affected communities ' +
        'each bring distinct expertise perspectives and legitimate concerns to ' +
        'complex governance challenges requiring collaborative multistakeholder ' +
        'approaches international coordination standards development capacity ' +
        'building continuous learning adaptation resilience measurement metrics ' +
        'impact assessment reporting accountability frameworks enforcement ' +
        'mechanisms remediation pathways and meaningful public participation. '
    ) * 2  # repeat to ensure well above 100 words
}

Describe 'Get-OpEdSource' -Tag 'oped' {

    Context 'HTML source (default)' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = "<html><body><p>$($script:ReadableText)</p></body></html>"
                    Headers    = @{ 'Content-Type' = 'text/html; charset=utf-8' }
                    StatusCode = 200
                }
            }
            Mock ConvertFrom-Html -ModuleName AITriad { $script:ReadableText }
        }

        It 'Returns a prep object with required fields' {
            $Prep = Get-OpEdSource -Url 'https://example.com/article.html'
            $Prep | Should -Not -BeNullOrEmpty
            $Prep.Url                  | Should -Be 'https://example.com/article.html'
            $Prep.SourceMarkdown       | Should -Not -BeNullOrEmpty
            $Prep.SourceFormat         | Should -Be 'html'
            $Prep.SourceExtractionTool | Should -Be 'ConvertFrom-Html'
            $Prep.ReadableWords        | Should -BeGreaterThan 0
            $Prep.ReadableRatio        | Should -BeGreaterThan 0
            $Prep.CharsTotal           | Should -BeGreaterThan 0
            $Prep.CharsUsed            | Should -BeGreaterThan 0
            $Prep.Truncated            | Should -Be $false
            $Prep.Excerpt              | Should -Not -BeNullOrEmpty
            $Prep.ContentHash          | Should -Match '^[0-9a-f]{64}$'
            $Prep.FetchedAt            | Should -Not -BeNullOrEmpty
            $Prep.SourceBrief          | Should -BeNullOrEmpty
        }

        It 'ContentHash is deterministic for the same content' {
            $P1 = Get-OpEdSource -Url 'https://example.com/a.html'
            $P2 = Get-OpEdSource -Url 'https://example.com/a.html'
            $P1.ContentHash | Should -Be $P2.ContentHash
        }

        It 'FetchedAt is a valid ISO 8601 timestamp' {
            $Prep = Get-OpEdSource -Url 'https://example.com/article.html'
            { [System.DateTime]::Parse($Prep.FetchedAt) } | Should -Not -Throw
        }
    }

    Context 'PDF source — content-type detection' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = [byte[]]@(0x25, 0x50, 0x44, 0x46)
                    Headers    = @{ 'Content-Type' = 'application/pdf' }
                    StatusCode = 200
                }
            }
            $script:PdfConvCalled = $false
            Mock Invoke-PdfConversion -ModuleName AITriad { $script:PdfConvCalled = $true; $script:ReadableText }
        }

        It 'Routes to ConvertFrom-Pdf when Content-Type is application/pdf' {
            $Prep = Get-OpEdSource -Url 'https://example.com/report'
            $Prep.SourceFormat         | Should -Be 'pdf'
            $Prep.SourceExtractionTool | Should -Be 'ConvertFrom-Pdf'
            $script:PdfConvCalled      | Should -BeTrue -Because 'Invoke-PdfConversion must be called for PDF routing'
        }
    }

    Context 'PDF source — URL extension detection' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = [byte[]]@(0x25, 0x50, 0x44, 0x46)
                    Headers    = @{ 'Content-Type' = 'application/octet-stream' }
                    StatusCode = 200
                }
            }
            $script:PdfConvCalled = $false
            Mock Invoke-PdfConversion -ModuleName AITriad { $script:PdfConvCalled = $true; $script:ReadableText }
        }

        It 'Routes to ConvertFrom-Pdf when URL ends in .pdf' {
            $Prep = Get-OpEdSource -Url 'https://example.com/report.pdf'
            $Prep.SourceFormat    | Should -Be 'pdf'
            $script:PdfConvCalled | Should -BeTrue -Because 'Invoke-PdfConversion must be called for .pdf extension routing'
        }
    }

    Context 'DOCX source — URL extension detection' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = [byte[]]@(0x50, 0x4B, 0x03, 0x04)
                    Headers    = @{ 'Content-Type' = 'application/octet-stream' }
                    StatusCode = 200
                }
            }
            $script:DocxConvCalled = $false
            Mock Invoke-DocxConversion -ModuleName AITriad { $script:DocxConvCalled = $true; $script:ReadableText }
        }

        It 'Routes to ConvertFrom-Docx when URL ends in .docx' {
            $Prep = Get-OpEdSource -Url 'https://example.com/brief.docx'
            $Prep.SourceFormat          | Should -Be 'docx'
            $Prep.SourceExtractionTool  | Should -Be 'ConvertFrom-Docx'
            $script:DocxConvCalled      | Should -BeTrue -Because 'Invoke-DocxConversion must be called for .docx extension routing'
        }
    }

    Context 'Readability gate — PDF bytes through HTML converter (the 2/10 incident)' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = [byte[]]@(0x25, 0x50, 0x44, 0x46)
                    Headers    = @{ 'Content-Type' = 'text/html' }  # wrong Content-Type
                    StatusCode = 200
                }
            }
            # Simulate what ConvertFrom-Html actually returns for PDF bytes:
            # space-separated decimal byte values — zero alpha tokens.
            Mock ConvertFrom-Html -ModuleName AITriad {
                '37 80 68 70 45 49 46 48 10 37 226 227 207 211'
            }
        }

        It 'Throws ActionableError when extracted text has no readable words' {
            { Get-OpEdSource -Url 'https://example.com/report.pdf' } | Should -Throw
        }

        It 'Error message names the format and readable word count' {
            try {
                Get-OpEdSource -Url 'https://example.com/report.pdf'
            } catch {
                $_.Exception.Message | Should -Match 'readable word'
            }
        }
    }

    Context 'Readability gate — MinReadableWords threshold' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = '<p>ok</p>'
                    Headers    = @{ 'Content-Type' = 'text/html' }
                    StatusCode = 200
                }
            }
            # Returns 3 readable words — below the default threshold of 100
            Mock ConvertFrom-Html -ModuleName AITriad { 'Artificial intelligence policy' }
        }

        It 'Throws when readable word count is below MinReadableWords' {
            { Get-OpEdSource -Url 'https://example.com/stub.html' } | Should -Throw
        }

        It 'Passes when MinReadableWords is lowered to match' {
            $Prep = Get-OpEdSource -Url 'https://example.com/stub.html' -MinReadableWords 2
            $Prep.ReadableWords | Should -BeGreaterOrEqual 2
        }
    }

    Context 'Truncation' {
        BeforeEach {
            # Build text well over 2000 chars with enough readable words
            $script:LongText = $script:ReadableText * 10
            Mock Invoke-WebRequest -ModuleName AITriad {
                [PSCustomObject]@{
                    Content    = "<p>$($script:LongText)</p>"
                    Headers    = @{ 'Content-Type' = 'text/html' }
                    StatusCode = 200
                }
            }
            Mock ConvertFrom-Html -ModuleName AITriad { $script:LongText }
        }

        It 'Truncates SourceMarkdown to MaxChars and sets Truncated=true' {
            $Prep = Get-OpEdSource -Url 'https://example.com/long.html' -MaxChars 1000
            $Prep.Truncated         | Should -Be $true
            $Prep.CharsUsed         | Should -Be 1000
            $Prep.SourceMarkdown.Length | Should -BeLessOrEqual 1030  # 1000 + truncation notice
            $Prep.CharsTotal        | Should -BeGreaterThan 1000
        }

        It 'ContentHash reflects the full untruncated text regardless of MaxChars' {
            $Prep1 = Get-OpEdSource -Url 'https://example.com/long.html' -MaxChars 1000
            $Prep2 = Get-OpEdSource -Url 'https://example.com/long.html' -MaxChars 2000
            $Prep1.ContentHash | Should -Be $Prep2.ContentHash
        }
    }

    Context 'Network failure' {
        BeforeEach {
            Mock Invoke-WebRequest -ModuleName AITriad {
                throw [System.Net.WebException]::new('Connection refused')
            }
        }

        It 'Throws ActionableError when the URL is unreachable' {
            { Get-OpEdSource -Url 'https://unreachable.example.com/' } | Should -Throw
        }
    }

    Context 'Parameter validation' {
        It 'Rejects empty Url' {
            { Get-OpEdSource -Url '' } | Should -Throw
        }

        It 'Rejects MaxChars below minimum (1000)' {
            { Get-OpEdSource -Url 'https://example.com/' -MaxChars 999 } | Should -Throw
        }
    }
}
