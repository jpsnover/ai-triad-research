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
            if ($IsMacOS -and (Test-Path '/usr/sbin/cupsfilter')) {
                # macOS fallback: pandoc → HTML → PDF via cupsfilter
                $UseFallback = $true
                $FallbackEngine = 'cupsfilter'
                Write-Verbose 'No dedicated PDF engine found — using pandoc → HTML → cupsfilter fallback'
            }
            elseif ($IsWindows) {
                # Windows fallback: pandoc → HTML → PDF via Edge or Chrome headless
                $BrowserPath = $null
                # Edge (ships with Windows 10/11)
                $EdgePath = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
                if (-not (Test-Path $EdgePath)) {
                    $EdgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
                }
                if (Test-Path $EdgePath) { $BrowserPath = $EdgePath }
                # Chrome fallback
                if (-not $BrowserPath) {
                    $ChromePath = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
                    if (-not (Test-Path $ChromePath)) {
                        $ChromePath = Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
                    }
                    if (Test-Path $ChromePath) { $BrowserPath = $ChromePath }
                }
                if ($BrowserPath) {
                    $UseFallback = $true
                    $FallbackEngine = 'browser'
                    Write-Verbose "No dedicated PDF engine found — using pandoc → HTML → browser fallback ($BrowserPath)"
                }
                else {
                    throw @"
No PDF engine found. Install one of:
  - typst:       winget install typst.typst
  - wkhtmltopdf: winget install wkhtmltopdf
  - weasyprint:  pip install weasyprint
  - MiKTeX:      winget install MiKTeX.MiKTeX
"@
                }
            }
            else {
                throw @"
No PDF engine found. Install one of:
  - typst:       brew install typst  (macOS) / cargo install typst-cli (Linux)
  - weasyprint:  pip install weasyprint
  - LaTeX:       brew install --cask mactex-no-gui  (macOS) / apt install texlive-xetex (Linux)
"@
            }
        }

        if ($OutputDirectory -and -not (Test-Path $OutputDirectory)) {
            try {
                $null = New-Item -Path $OutputDirectory -ItemType Directory -Force -ErrorAction Stop
            } catch {
                throw "Failed to create output directory '$OutputDirectory': $_`nCheck that the parent directory exists and you have write permissions."
            }
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
                if ($OutputDirectory) { $OutDir = Resolve-Path $OutputDirectory } else { $OutDir = $SourceItem.DirectoryName }
                $PdfPath = Join-Path $OutDir "$BaseName.pdf"

                try {
                    if ($UseFallback) {
                        # Fallback: pandoc → standalone HTML → platform tool → PDF
                        $TempHtml = [System.IO.Path]::GetTempFileName() + '.html'
                        $CssBody = if ($IsWindows) {
                            'body{font-family:Segoe UI,sans-serif;max-width:48em;margin:auto;padding:2em;font-size:11pt}pre{background:%23f5f5f5;padding:1em;overflow-x:auto}code{font-family:Cascadia Code,Consolas,monospace;font-size:0.9em}'
                        } else {
                            'body{font-family:Helvetica Neue,sans-serif;max-width:48em;margin:auto;padding:2em;font-size:11pt}pre{background:%23f5f5f5;padding:1em;overflow-x:auto}code{font-family:Menlo,monospace;font-size:0.9em}'
                        }
                        $HtmlArgs = @(
                            $SourcePath
                            '-o', $TempHtml
                            '--standalone'
                            '--self-contained'
                            '--highlight-style', 'tango'
                            '--metadata', "title=$BaseName"
                            '-c', "data:text/css,$CssBody"
                        )
                        if ($TableOfContents) { $HtmlArgs += '--toc' }

                        Write-Verbose "pandoc → HTML: $($HtmlArgs -join ' ')"
                        & $PandocPath @HtmlArgs 2>&1 | ForEach-Object {
                            if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Warning "pandoc: $_" }
                        }

                        if (Test-Path $TempHtml) {
                            if ($FallbackEngine -eq 'browser') {
                                # Windows: Edge or Chrome headless --print-to-pdf
                                $TempHtmlUri = ([Uri]::new($TempHtml)).AbsoluteUri
                                $BrowserArgs = @(
                                    '--headless'
                                    '--disable-gpu'
                                    "--print-to-pdf=$PdfPath"
                                    "--print-to-pdf-no-header"
                                    $TempHtmlUri
                                )
                                Write-Verbose "browser → PDF: $BrowserPath $($BrowserArgs -join ' ')"
                                & $BrowserPath @BrowserArgs 2>&1 | Out-Null
                            }
                            else {
                                # macOS: cupsfilter
                                Write-Verbose "cupsfilter → PDF"
                                & /bin/bash -c "/usr/sbin/cupsfilter '$TempHtml' > '$PdfPath' 2>/dev/null"
                            }
                            Remove-Item $TempHtml -ErrorAction SilentlyContinue
                        }
                    }
                    else {
                        # Direct pandoc → PDF via engine
                        $TexHeader = $null
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
                            Write-Utf8NoBom -Path $TexHeader -Value '\usepackage[dvipsnames]{xcolor}' 
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
                        if ($null -ne $TexHeader -and (Test-Path $TexHeader)) { Remove-Item $TexHeader -ErrorAction SilentlyContinue }
                    }

                    if ((Test-Path $PdfPath) -and (Get-Item $PdfPath).Length -gt 0) {
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
                        if ($UseFallback) { $EngineInfo = "$FallbackEngine (HTML fallback)" } else { $EngineInfo = $PdfEngine }
                        Write-Error @"
PDF conversion failed for: $SourcePath
  Engine: $EngineInfo
  Expected output: $PdfPath
  Input size: $((Get-Item $SourcePath).Length) bytes

Troubleshooting:
  1. Verify the Markdown is valid: pandoc '$SourcePath' -t plain | Select-Object -First 5
  2. Try a different engine: Convert-MD2PDF '$SourcePath' (ensure typst/xelatex is installed)
  3. Check pandoc version: pandoc --version
"@
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
