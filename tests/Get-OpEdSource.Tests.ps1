# Tag: oped (t/2586, t/3307)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Get-OpEdSource — convert-only (t/3307).
.DESCRIPTION
    Get-OpEdSource no longer fetches; it converts pre-fetched content from a temp file, dispatching
    on the authoritative Content-Type (NOT the extension). These tests mock the DocConverter cmdlets
    and write real temp files to verify Content-Type dispatch, the enumerated failure ErrorTypes
    (ContentPathMissing / UnsupportedContentType / ConversionFailed / InsufficientReadableText carried
    on the thrown ErrorRecord's TargetObject), the readability gate, truncation, and output shape —
    without network access or binary tools.
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

    # Create a real temp file with the given bytes/text and return its path (dispatch is on
    # ContentType, so the extension here is deliberately arbitrary).
    function New-ContentFile {
        param([string]$Text = 'placeholder', [string]$Extension = '.tmp')
        $Path = [System.IO.Path]::GetTempFileName() + $Extension
        [System.IO.File]::WriteAllText($Path, $Text)
        return $Path
    }
}

Describe 'Get-OpEdSource (convert-only)' -Tag 'oped' {

    Context 'HTML source' {
        BeforeEach {
            $script:HtmlFile = New-ContentFile -Text '<html><body><p>hi</p></body></html>' -Extension '.html'
            Mock ConvertFrom-Html -ModuleName AITriad { $script:ReadableText }
        }
        AfterEach { Remove-Item -LiteralPath $script:HtmlFile -Force -ErrorAction SilentlyContinue }

        It 'Returns a prep object with the convert-only fields' {
            $Prep = Get-OpEdSource -ContentPath $script:HtmlFile -ContentType 'text/html; charset=utf-8' -SourceUrl 'https://example.com/article'
            $Prep                      | Should -Not -BeNullOrEmpty
            $Prep.SourceUrl            | Should -Be 'https://example.com/article'
            $Prep.ContentType          | Should -Be 'text/html; charset=utf-8'
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

        It 'Does NOT expose a Url property (renamed to SourceUrl in convert-only)' {
            $Prep = Get-OpEdSource -ContentPath $script:HtmlFile -ContentType 'text/html'
            $Prep.PSObject.Properties.Name | Should -Not -Contain 'Url'
            $Prep.PSObject.Properties.Name | Should -Contain 'SourceUrl'
        }

        It 'ContentHash is deterministic for the same converted text' {
            $P1 = Get-OpEdSource -ContentPath $script:HtmlFile -ContentType 'text/html'
            $P2 = Get-OpEdSource -ContentPath $script:HtmlFile -ContentType 'text/html'
            $P1.ContentHash | Should -Be $P2.ContentHash
        }
    }

    Context 'Content-Type dispatch is authoritative (not the file extension)' {
        It 'Routes to ConvertFrom-Pdf when ContentType is application/pdf even if the temp file is named .html' {
            $File = New-ContentFile -Text 'ignored' -Extension '.html'   # deliberately mis-named
            try {
                $called = $false
                Mock Invoke-PdfConversion -ModuleName AITriad { $script:PdfCalled = $true; $script:ReadableText }
                $script:PdfCalled = $false
                $Prep = Get-OpEdSource -ContentPath $File -ContentType 'application/pdf'
                $Prep.SourceFormat         | Should -Be 'pdf'
                $Prep.SourceExtractionTool | Should -Be 'ConvertFrom-Pdf'
                $script:PdfCalled          | Should -BeTrue -Because 'ContentType application/pdf must dispatch to the PDF converter regardless of the .html temp name'
            } finally { Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue }
        }

        It 'Routes to ConvertFrom-Docx when ContentType is wordprocessingml even if the temp file is named .pdf' {
            $File = New-ContentFile -Text 'ignored' -Extension '.pdf'    # deliberately mis-named
            try {
                Mock Invoke-DocxConversion -ModuleName AITriad { $script:DocxCalled = $true; $script:ReadableText }
                $script:DocxCalled = $false
                $Prep = Get-OpEdSource -ContentPath $File -ContentType 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                $Prep.SourceFormat         | Should -Be 'docx'
                $Prep.SourceExtractionTool | Should -Be 'ConvertFrom-Docx'
                $script:DocxCalled         | Should -BeTrue
            } finally { Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue }
        }
    }

    Context 'Failure: ContentPathMissing' {
        It 'Throws with ErrorType ContentPathMissing on a non-existent ContentPath' {
            $Missing = Join-Path ([System.IO.Path]::GetTempPath()) ('nope-' + [guid]::NewGuid() + '.pdf')
            $err = $null
            try { Get-OpEdSource -ContentPath $Missing -ContentType 'application/pdf' } catch { $err = $_ }
            $err                        | Should -Not -BeNullOrEmpty
            $err.TargetObject.ErrorType | Should -Be 'ContentPathMissing'
            $err.TargetObject.Problem   | Should -Match 'not found or is not readable'
        }
    }

    Context 'Failure: UnsupportedContentType' {
        It 'Throws with ErrorType UnsupportedContentType for a non-document Content-Type' {
            $File = New-ContentFile -Extension '.bin'
            try {
                $err = $null
                try { Get-OpEdSource -ContentPath $File -ContentType 'image/png' } catch { $err = $_ }
                $err                        | Should -Not -BeNullOrEmpty
                $err.TargetObject.ErrorType | Should -Be 'UnsupportedContentType'
            } finally { Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue }
        }
    }

    Context 'Failure: ConversionFailed' {
        It 'Throws with ErrorType ConversionFailed when the converter throws' {
            $File = New-ContentFile -Extension '.pdf'
            try {
                Mock Invoke-PdfConversion -ModuleName AITriad { throw 'pdftotext not found' }
                $err = $null
                try { Get-OpEdSource -ContentPath $File -ContentType 'application/pdf' } catch { $err = $_ }
                $err                        | Should -Not -BeNullOrEmpty
                $err.TargetObject.ErrorType | Should -Be 'ConversionFailed'
            } finally { Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue }
        }
    }

    Context 'Failure: InsufficientReadableText (readability gate)' {
        BeforeEach {
            $script:StubFile = New-ContentFile -Extension '.html'
            # Simulate PDF-bytes-through-HTML: space-separated decimal byte values — zero alpha tokens.
            Mock ConvertFrom-Html -ModuleName AITriad { '37 80 68 70 45 49 46 48 10 37 226 227 207 211' }
        }
        AfterEach { Remove-Item -LiteralPath $script:StubFile -Force -ErrorAction SilentlyContinue }

        It 'Throws with ErrorType InsufficientReadableText and keeps the -Topic-text next-step' {
            $err = $null
            try { Get-OpEdSource -ContentPath $script:StubFile -ContentType 'text/html' } catch { $err = $_ }
            $err                          | Should -Not -BeNullOrEmpty
            $err.TargetObject.ErrorType   | Should -Be 'InsufficientReadableText'
            $err.Exception.Message        | Should -Match 'readable word'
            ($err.TargetObject.NextSteps -join ' ') | Should -Match '-Topic text'
        }
    }

    Context 'Truncation' {
        BeforeEach {
            $script:LongFile = New-ContentFile -Extension '.html'
            $script:LongText = $script:ReadableText * 10
            Mock ConvertFrom-Html -ModuleName AITriad { $script:LongText }
        }
        AfterEach { Remove-Item -LiteralPath $script:LongFile -Force -ErrorAction SilentlyContinue }

        It 'Truncates SourceMarkdown to MaxChars and sets Truncated=true' {
            $Prep = Get-OpEdSource -ContentPath $script:LongFile -ContentType 'text/html' -MaxChars 1000
            $Prep.Truncated             | Should -Be $true
            $Prep.CharsUsed             | Should -Be 1000
            $Prep.SourceMarkdown.Length | Should -BeLessOrEqual 1030   # 1000 + truncation notice
            $Prep.CharsTotal            | Should -BeGreaterThan 1000
        }

        It 'ContentHash reflects the full untruncated text regardless of MaxChars' {
            $P1 = Get-OpEdSource -ContentPath $script:LongFile -ContentType 'text/html' -MaxChars 1000
            $P2 = Get-OpEdSource -ContentPath $script:LongFile -ContentType 'text/html' -MaxChars 2000
            $P1.ContentHash | Should -Be $P2.ContentHash
        }
    }

    Context 'Parameter validation' {
        It 'Rejects empty ContentPath' {
            { Get-OpEdSource -ContentPath '' -ContentType 'text/html' } | Should -Throw
        }
        It 'Rejects empty ContentType' {
            $File = New-ContentFile
            try { { Get-OpEdSource -ContentPath $File -ContentType '' } | Should -Throw }
            finally { Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue }
        }
        It 'Rejects MaxChars below minimum (1000)' {
            $File = New-ContentFile
            try { { Get-OpEdSource -ContentPath $File -ContentType 'text/html' -MaxChars 999 } | Should -Throw }
            finally { Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue }
        }
    }
}
