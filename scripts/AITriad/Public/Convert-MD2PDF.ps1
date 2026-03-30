# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Converts Markdown files to PDF using pandoc.
.DESCRIPTION
    Accepts Markdown file paths as strings, FileInfo objects, or via pipeline.
    Output PDF has the same base name with a .pdf extension, written to the
    same directory as the source file (or to -OutputDirectory if specified).
.EXAMPLE
    Convert-MD2PDF ./debate.md
.EXAMPLE
    Get-ChildItem *.md | Convert-MD2PDF
.EXAMPLE
    'report.md', 'notes.md' | Convert-MD2PDF -OutputDirectory ./pdfs
.EXAMPLE
    Convert-MD2PDF -Path ./docs/*.md -Margin 1in
#>
function Convert-MD2PDF {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName', 'PSPath')]
        [string[]]$Path,

        [Parameter()]
        [string]$OutputDirectory,

        [Parameter()]
        [string]$PandocPath,

        [Parameter()]
        [ValidateSet('letter', 'a4')]
        [string]$PaperSize = 'letter',

        [Parameter()]
        [string]$Margin = '0.75in',

        [Parameter()]
        [switch]$TableOfContents,

        [Parameter()]
        [switch]$Show
    )

    begin {
        Set-StrictMode -Version Latest

        # Resolve pandoc
        if ($PandocPath) {
            if (-not (Test-Path $PandocPath)) {
                throw "Pandoc not found at: $PandocPath"
            }
        }
        else {
            $PandocPath = Get-Command pandoc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
            if (-not $PandocPath) {
                throw 'pandoc is not installed. Install with: brew install pandoc'
            }
        }

        # Verify PDF engine is available
        # Priority: typst (lightweight, fast) > LaTeX engines > weasyprint > HTML fallback
        $PdfEngine = $null
        $UseFallback = $false
        foreach ($engine in @('typst', 'xelatex', 'lualatex', 'pdflatex', 'weasyprint', 'wkhtmltopdf')) {
            if (Get-Command $engine -ErrorAction SilentlyContinue) {
                $PdfEngine = $engine
                break
            }
        }
        if (-not $PdfEngine) {
            # macOS fallback: pandoc → HTML → PDF via cupsfilter or textutil
            if ($IsMacOS -and (Test-Path '/usr/sbin/cupsfilter')) {
                $UseFallback = $true
                Write-Verbose 'No dedicated PDF engine found — using pandoc → HTML → cupsfilter fallback'
            }
            else {
                throw 'No PDF engine found. Install one of: typst (brew install typst), MacTeX (brew install --cask mactex-no-gui), or weasyprint (pip install weasyprint).'
            }
        }

        if ($OutputDirectory -and -not (Test-Path $OutputDirectory)) {
            $null = New-Item -Path $OutputDirectory -ItemType Directory -Force
        }

        $Converted = [System.Collections.Generic.List[PSObject]]::new()
    }

    process {
        foreach ($Item in $Path) {
            # Resolve the actual file path (handles wildcards, relative paths, FileInfo objects)
            $ResolvedPaths = @(Resolve-Path -Path $Item -ErrorAction SilentlyContinue)
            if ($ResolvedPaths.Count -eq 0) {
                Write-Error "File not found: $Item"
                continue
            }

            foreach ($Resolved in $ResolvedPaths) {
                $SourcePath = $Resolved.Path
                $SourceItem = Get-Item $SourcePath

                if ($SourceItem.Extension -notin @('.md', '.markdown', '.mdown', '.mkd')) {
                    Write-Warning "Skipping non-Markdown file: $SourcePath"
                    continue
                }

                # Determine output path
                $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($SourceItem.Name)
                $OutDir = if ($OutputDirectory) { Resolve-Path $OutputDirectory } else { $SourceItem.DirectoryName }
                $PdfPath = Join-Path $OutDir "$BaseName.pdf"

                try {
                    if ($UseFallback) {
                        # Fallback: pandoc → standalone HTML → cupsfilter → PDF
                        $TempHtml = [System.IO.Path]::GetTempFileName() + '.html'
                        $HtmlArgs = @(
                            $SourcePath
                            '-o', $TempHtml
                            '--standalone'
                            '--self-contained'
                            '--highlight-style', 'tango'
                            '--metadata', "title=$BaseName"
                            '-c', 'data:text/css,body{font-family:Helvetica Neue,sans-serif;max-width:48em;margin:auto;padding:2em;font-size:11pt}pre{background:%23f5f5f5;padding:1em;overflow-x:auto}code{font-family:Menlo,monospace;font-size:0.9em}'
                        )
                        if ($TableOfContents) { $HtmlArgs += '--toc' }

                        Write-Verbose "pandoc → HTML: $($HtmlArgs -join ' ')"
                        & $PandocPath @HtmlArgs 2>&1 | ForEach-Object {
                            if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Warning "pandoc: $_" }
                        }

                        if (Test-Path $TempHtml) {
                            Write-Verbose "cupsfilter → PDF"
                            & /bin/bash -c "/usr/sbin/cupsfilter '$TempHtml' > '$PdfPath' 2>/dev/null"
                            Remove-Item $TempHtml -ErrorAction SilentlyContinue
                        }
                    }
                    else {
                        # Direct pandoc → PDF via engine
                        $PandocArgs = @(
                            $SourcePath
                            '-o', $PdfPath
                            '--pdf-engine', $PdfEngine
                            '--highlight-style', 'tango'
                        )

                        # Engine-specific options
                        if ($PdfEngine -eq 'typst') {
                            $PandocArgs += @('-V', "margin-x=$Margin", '-V', "margin-y=$Margin")
                        }
                        elseif ($PdfEngine -in @('xelatex', 'lualatex', 'pdflatex')) {
                            # Create a temp LaTeX header with xcolor package for colored text
                            $TexHeader = Join-Path ([System.IO.Path]::GetTempPath()) "pandoc-header-$([guid]::NewGuid().ToString('N').Substring(0,8)).tex"
                            Set-Content -Path $TexHeader -Value '\usepackage[dvipsnames]{xcolor}' -Encoding UTF8
                            $PandocArgs += @(
                                '-V', "geometry:margin=$Margin"
                                '-V', "papersize:$PaperSize"
                                '-V', 'colorlinks=true'
                                '-V', 'linkcolor=blue'
                                '-H', $TexHeader
                            )
                            if ($PdfEngine -in @('xelatex', 'lualatex')) {
                                $PandocArgs += @('-V', 'mainfont:Helvetica Neue', '-V', 'monofont:Menlo')
                            }
                        }
                        elseif ($PdfEngine -eq 'weasyprint') {
                            $PandocArgs += @('--css', 'data:text/css,@page{size:' + $PaperSize + ';margin:' + $Margin + '}')
                        }

                        if ($TableOfContents) { $PandocArgs += '--toc' }

                        Write-Verbose "pandoc $($PandocArgs -join ' ')"
                        & $PandocPath @PandocArgs 2>&1 | ForEach-Object {
                            if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Warning "pandoc: $_" }
                        }
                        # Clean up temp header file
                        if ($TexHeader -and (Test-Path $TexHeader)) { Remove-Item $TexHeader -ErrorAction SilentlyContinue }
                    }

                    if (Test-Path $PdfPath) {
                        $PdfItem = Get-Item $PdfPath
                        $Result = [PSCustomObject]@{
                            Source = $SourcePath
                            PDF    = $PdfPath
                            Size   = $PdfItem.Length
                        }
                        $Converted.Add($Result)
                        Write-Verbose "Created: $PdfPath ($([math]::Round($PdfItem.Length / 1024))KB)"
                        if ($Show) {
                            if ($IsMacOS)       { & open $PdfPath }
                            elseif ($IsWindows) { & start $PdfPath }
                            else                { & xdg-open $PdfPath }
                        }
                        $Result
                    }
                    else {
                        Write-Error "pandoc completed but PDF was not created: $PdfPath"
                    }
                }
                catch {
                    Write-Error "Failed to convert $SourcePath : $_"
                }
            }
        }
    }

    end {
        if ($Converted.Count -gt 1) {
            Write-Verbose "Converted $($Converted.Count) files"
        }
    }
}
