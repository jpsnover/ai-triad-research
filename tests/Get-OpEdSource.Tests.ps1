# Tag: oped (t/2586, t/3307)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Get-OpEdSource — convert-only (t/3307).
.DESCRIPTION
    Get-OpEdSource no longer fetches (the URL fetch moved to the shared Node fetcher, t/3306). It
    reads a caller-owned temp file, dispatches on -ContentType (authoritative, not the extension),
    converts, applies the readability gate, and returns the prep object — or throws an ActionableError
    whose TargetObject carries {ErrorType,Goal,Problem,Location,NextSteps} for the shim to serialize.
    Mocks the DocConverter cmdlets so no binary tools / network are needed.
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
    ) * 2

    # Create a temp file with given bytes/text; tracked for cleanup. Returns the path.
    $script:TempFiles = [System.Collections.Generic.List[string]]::new()
    function script:New-SourceTemp {
        param([string]$Text = 'placeholder', [string]$Extension = '.dat')
        $path = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(),
            "opedsrc-$([System.Guid]::NewGuid().ToString('n'))$Extension")
        [System.IO.File]::WriteAllText($path, $Text)
        $script:TempFiles.Add($path)
        return $path
    }
}

AfterAll {
    foreach ($f in $script:TempFiles) {
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    }
}

Describe 'Get-OpEdSource (convert-only)' -Tag 'oped' {

    Context 'HTML source (default dispatch)' {
        BeforeEach {
            Mock ConvertFrom-Html -ModuleName AITriad { $script:ReadableText }
            $script:HtmlPath = script:New-SourceTemp -Text "<html><body><p>$($script:ReadableText)</p></body></html>" -Extension '.html'
        }

        It 'Returns a prep object with required fields' {
            $Prep = Get-OpEdSource -ContentPath $script:HtmlPath -ContentType 'text/html; charset=utf-8' -SourceUrl 'https://example.com/article.html'
            $Prep                      | Should -Not -BeNullOrEmpty
            $Prep.SourceUrl            | Should -Be 'https://example.com/article.html'
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

        It 'ContentHash is deterministic for the same content' {
            $P1 = Get-OpEdSource -ContentPath $script:HtmlPath -ContentType 'text/html'
            $P2 = Get-OpEdSource -ContentPath $script:HtmlPath -ContentType 'text/html'
            $P1.ContentHash | Should -Be $P2.ContentHash
        }

        It 'FetchedAt is a valid ISO 8601 timestamp' {
            $Prep = Get-OpEdSource -ContentPath $script:HtmlPath -ContentType 'text/html'
            { [System.DateTime]::Parse($Prep.FetchedAt) } | Should -Not -Throw
        }

        It 'Treats empty ContentType as HTML' {
            $Prep = Get-OpEdSource -ContentPath $script:HtmlPath -ContentType ' '
            $Prep.SourceFormat | Should -Be 'html'
        }
    }

    Context 'ContentType is authoritative over the filename extension (t/3306#4)' {
        BeforeEach {
            $script:PdfConvCalled = $false
            Mock Invoke-PdfConversion -ModuleName AITriad { $script:PdfConvCalled = $true; $script:ReadableText }
            Mock ConvertFrom-Html    -ModuleName AITriad { throw 'ConvertFrom-Html must NOT be called for a PDF content-type' }
            # File named .html but the bytes are a PDF — ContentType must win.
            $script:MisnamedPath = script:New-SourceTemp -Text 'dummy' -Extension '.html'
        }

        It 'Routes a .html-named file to the PDF converter when ContentType is application/pdf' {
            $Prep = Get-OpEdSource -ContentPath $script:MisnamedPath -ContentType 'application/pdf'
            $Prep.SourceFormat         | Should -Be 'pdf'
            $Prep.SourceExtractionTool | Should -Be 'ConvertFrom-Pdf'
            $script:PdfConvCalled      | Should -BeTrue -Because 'dispatch keys on ContentType, not the .html extension'
        }
    }

    Context 'DOCX dispatch by ContentType' {
        BeforeEach {
            $script:DocxConvCalled = $false
            Mock Invoke-DocxConversion -ModuleName AITriad { $script:DocxConvCalled = $true; $script:ReadableText }
            $script:DocxPath = script:New-SourceTemp -Text 'dummy' -Extension '.bin'
        }

        It 'Routes to ConvertFrom-Docx for the wordprocessingml content-type' {
            $Prep = Get-OpEdSource -ContentPath $script:DocxPath -ContentType 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            $Prep.SourceFormat          | Should -Be 'docx'
            $Prep.SourceExtractionTool  | Should -Be 'ConvertFrom-Docx'
            $script:DocxConvCalled      | Should -BeTrue
        }
    }

    Context 'ContentPathMissing' {
        It 'Throws with ErrorType ContentPathMissing when the file does not exist' {
            $err = $null
            try { Get-OpEdSource -ContentPath (Join-Path ([System.IO.Path]::GetTempPath()) 'does-not-exist-xyz.dat') -ContentType 'application/pdf' }
            catch { $err = $_ }
            $err | Should -Not -BeNullOrEmpty
            $err.TargetObject.ErrorType | Should -Be 'ContentPathMissing'
            $err.TargetObject.NextSteps | Should -Not -BeNullOrEmpty
        }
    }

    Context 'UnsupportedContentType' {
        It 'Throws with ErrorType UnsupportedContentType for a binary image' {
            $path = script:New-SourceTemp -Text 'binary' -Extension '.png'
            $err = $null
            try { Get-OpEdSource -ContentPath $path -ContentType 'image/png' } catch { $err = $_ }
            $err.TargetObject.ErrorType | Should -Be 'UnsupportedContentType'
        }
    }

    Context 'ConversionFailed' {
        It 'Throws with ErrorType ConversionFailed when the converter throws' {
            Mock Invoke-PdfConversion -ModuleName AITriad { throw 'pdftotext not found' }
            $path = script:New-SourceTemp -Text 'dummy' -Extension '.pdf'
            $err = $null
            try { Get-OpEdSource -ContentPath $path -ContentType 'application/pdf' } catch { $err = $_ }
            $err.TargetObject.ErrorType | Should -Be 'ConversionFailed'
        }
    }

    Context 'Readability gate' {
        It 'Throws InsufficientReadableText when extracted text is byte-garbage (the 2/10 incident)' {
            # Simulate a mis-converted PDF: space-joined decimal byte values, zero alpha tokens.
            Mock ConvertFrom-Html -ModuleName AITriad { '37 80 68 70 45 49 46 48 10 37 226 227 207 211' }
            $path = script:New-SourceTemp -Text 'garbage' -Extension '.html'
            $err = $null
            try { Get-OpEdSource -ContentPath $path -ContentType 'text/html' } catch { $err = $_ }
            $err.TargetObject.ErrorType | Should -Be 'InsufficientReadableText'
            $err.Exception.Message      | Should -Match 'readable word'
        }

        It 'Throws when readable word count is below MinReadableWords' {
            Mock ConvertFrom-Html -ModuleName AITriad { 'Artificial intelligence policy' }
            $path = script:New-SourceTemp -Text 'stub' -Extension '.html'
            { Get-OpEdSource -ContentPath $path -ContentType 'text/html' } | Should -Throw
        }

        It 'Passes when MinReadableWords is lowered to match' {
            Mock ConvertFrom-Html -ModuleName AITriad { 'Artificial intelligence policy' }
            $path = script:New-SourceTemp -Text 'stub' -Extension '.html'
            $Prep = Get-OpEdSource -ContentPath $path -ContentType 'text/html' -MinReadableWords 2 -MinAlphaDensity 0.5
            $Prep.ReadableWords | Should -BeGreaterOrEqual 2
        }
    }

    Context 'Truncation' {
        BeforeEach {
            $script:LongText = $script:ReadableText * 10
            Mock ConvertFrom-Html -ModuleName AITriad { $script:LongText }
            $script:LongPath = script:New-SourceTemp -Text 'long' -Extension '.html'
        }

        It 'Truncates SourceMarkdown to MaxChars and sets Truncated=true' {
            $Prep = Get-OpEdSource -ContentPath $script:LongPath -ContentType 'text/html' -MaxChars 1000
            $Prep.Truncated             | Should -Be $true
            $Prep.CharsUsed             | Should -Be 1000
            $Prep.SourceMarkdown.Length | Should -BeLessOrEqual 1030
            $Prep.CharsTotal            | Should -BeGreaterThan 1000
        }

        It 'ContentHash reflects the full untruncated text regardless of MaxChars' {
            $P1 = Get-OpEdSource -ContentPath $script:LongPath -ContentType 'text/html' -MaxChars 1000
            $P2 = Get-OpEdSource -ContentPath $script:LongPath -ContentType 'text/html' -MaxChars 2000
            $P1.ContentHash | Should -Be $P2.ContentHash
        }
    }

    Context 'Parameter validation' {
        It 'Rejects empty ContentPath' {
            { Get-OpEdSource -ContentPath '' -ContentType 'text/html' } | Should -Throw
        }
        It 'Rejects empty ContentType' {
            $path = script:New-SourceTemp -Text 'x' -Extension '.html'
            { Get-OpEdSource -ContentPath $path -ContentType '' } | Should -Throw
        }
        It 'Rejects MaxChars below minimum (1000)' {
            $path = script:New-SourceTemp -Text 'x' -Extension '.html'
            { Get-OpEdSource -ContentPath $path -ContentType 'text/html' -MaxChars 999 } | Should -Throw
        }
    }
}
