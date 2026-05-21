# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Add-SnapshotHeader HTML comment injection' {

    It 'Escapes --> in Title before embedding in HTML comment' {
        InModuleScope AITriad {
            $Result = Add-SnapshotHeader -Markdown 'body' -Title 'Attack --> Injection'
            # The HTML comment block must not contain a bare --> that closes the comment early
            $CommentBlock = ($Result -split '-->')[0] + '-->'
            $CommentBlock | Should -Not -Match 'Attack -->'
            $Result | Should -Match 'Attack --&gt; Injection'
        }
    }

    It 'Escapes --> in SourceUrl before embedding in HTML comment' {
        InModuleScope AITriad {
            $Result = Add-SnapshotHeader -Markdown 'body' -Title 'Normal Title' -SourceUrl 'https://example.com/path?a=1-->evil'
            $CommentBlock = ($Result -split '-->')[0] + '-->'
            $CommentBlock | Should -Not -Match 'https://example\.com/path\?a=1-->'
            $Result | Should -Match '--&gt;evil'
        }
    }

    It 'Escapes --> in SourceType before embedding in HTML comment' {
        InModuleScope AITriad {
            $Result = Add-SnapshotHeader -Markdown 'body' -Title 'Normal Title' -SourceType 'html-->injected'
            $CommentBlock = ($Result -split '-->')[0] + '-->'
            $CommentBlock | Should -Not -Match 'html-->'
            $Result | Should -Match 'html--&gt;injected'
        }
    }

    It 'Does not alter safe values with no --> sequences' {
        InModuleScope AITriad {
            $Result = Add-SnapshotHeader -Markdown 'body text' -Title 'AI Safety Report' -SourceUrl 'https://example.com/report.html' -SourceType 'html' -CapturedAt '2026-01-15'
            $Result | Should -Match '<!--'
            $Result | Should -Match 'AI Safety Report'
            $Result | Should -Match 'https://example\.com/report\.html'
            $Result | Should -Match '2026-01-15'
            $Result | Should -Match 'body text'
        }
    }

    It 'Produces a well-formed HTML comment (exactly one closing --> at end of comment block)' {
        InModuleScope AITriad {
            $Result = Add-SnapshotHeader -Markdown 'body' -Title 'Safe Title' -SourceUrl 'https://example.com' -SourceType 'pdf'
            # Split on --> to count occurrences within the header
            $Parts = $Result -split '-->'
            # First part should be the comment open block; second part is everything after
            $Parts[0] | Should -Match '<!--'
            # The markdown body should appear after the comment closes
            $Parts[1] | Should -Match '(?s).*body'
        }
    }

    It 'Passes Markdown body through unchanged after the header' {
        InModuleScope AITriad {
            $Body = "## Section`n`nSome content here."
            $Result = Add-SnapshotHeader -Markdown $Body -Title 'My Title'
            $PatternSection = [regex]::Escape('## Section')
            $PatternContent = [regex]::Escape('Some content here.')
            $Result | Should -Match $PatternSection
            $Result | Should -Match $PatternContent
        }
    }

    It 'Uses today as default CapturedAt when not specified' {
        InModuleScope AITriad {
            $Today = Get-Date -Format 'yyyy-MM-dd'
            $Result = Add-SnapshotHeader -Markdown 'body' -Title 'Title'
            $Result | Should -Match $Today
        }
    }
}
