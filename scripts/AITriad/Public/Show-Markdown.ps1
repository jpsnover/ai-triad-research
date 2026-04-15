# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Renders a Markdown file for viewing.
.DESCRIPTION
    By default, converts Markdown to styled HTML and opens it in the default
    browser (returns immediately). With -Console, renders in the terminal
    using glow or pandoc. Accepts file paths as strings, FileInfo objects,
    or via pipeline.
.EXAMPLE
    Show-Markdown ./README.md
    Opens README.md as styled HTML in the default browser.
.EXAMPLE
    Show-Markdown ./debate.md -Console
    Renders debate.md in the terminal with glow.
.EXAMPLE
    Get-ChildItem *.md | Show-MD -Console -Width 120
.EXAMPLE
    Show-MD ./report.md -Console -Style dark
#>
function Show-Markdown {
    [CmdletBinding()]
    [Alias('Show-MD')]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName', 'PSPath')]
        [string[]]$Path,

        [Parameter()]
        [switch]$Console,

        [Parameter()]
        [int]$Width = 0,

        [Parameter()]
        [ValidateSet('dark', 'light', 'notty', 'auto')]
        [string]$Style = 'auto',

        [Parameter()]
        [switch]$Raw
    )

    begin {
        Set-StrictMode -Version Latest

        $PandocPath = Get-Command pandoc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

        if ($Console -or $Raw) {
            $GlowPath = Get-Command glow -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
            if (-not $GlowPath -and -not $PandocPath -and -not $Raw) {
                Write-Warning 'Neither glow nor pandoc found. Falling back to raw display. Install glow (brew install glow) for rich rendering.'
                $Raw = $true
            }
        }
        else {
            # Window mode needs pandoc for HTML conversion
            if (-not $PandocPath) {
                throw 'pandoc is required for window display. Install with: brew install pandoc'
            }
        }

$script:HtmlStyle = @'
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    max-width: 52em; margin: 2em auto; padding: 0 1.5em;
    line-height: 1.6; font-size: 15px;
    color: #1f2328; background: #fff;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e6edf3; background: #0d1117; }
    a { color: #58a6ff; }
    code, pre { background: #161b22; }
    blockquote { border-color: #3b434b; color: #8b949e; }
    hr { border-color: #30363d; }
    table th { background: #161b22; }
    table td, table th { border-color: #30363d; }
  }
  h1 { font-size: 1.8em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #d1d9e0; padding-bottom: .25em; margin-top: 1.5em; }
  h3 { font-size: 1.15em; margin-top: 1.3em; }
  code {
    font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.88em; padding: .15em .35em;
    background: #f0f3f6; border-radius: 4px;
  }
  pre { padding: 1em; overflow-x: auto; background: #f6f8fa; border-radius: 6px; line-height: 1.45; }
  pre code { padding: 0; background: none; }
  blockquote { margin: 0; padding: .5em 1em; border-left: 4px solid #d1d9e0; color: #656d76; }
  table { border-collapse: collapse; width: 100%; }
  table th, table td { border: 1px solid #d1d9e0; padding: .5em .8em; text-align: left; }
  table th { background: #f6f8fa; font-weight: 600; }
  hr { border: none; border-top: 1px solid #d1d9e0; margin: 1.5em 0; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  em { font-style: italic; }
  strong { font-weight: 600; }
  ul, ol { padding-left: 2em; }
  li + li { margin-top: .25em; }
  p.focus-metadata { font-style: italic; color: #1a4d8f; }
  @media (prefers-color-scheme: dark) {
    p.focus-metadata { color: #6daaed; }
  }
</style>
<script>
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('p').forEach(function(p) {
    if (p.textContent.trimStart().startsWith('Focus:') ||
        (p.firstElementChild && p.firstElementChild.tagName === 'EM' &&
         p.firstElementChild.textContent.trimStart().startsWith('Focus:'))) {
      p.classList.add('focus-metadata');
    }
  });
});
</script>
'@
    }

    process {
        foreach ($Item in $Path) {
            $ResolvedPaths = @(Resolve-Path -Path $Item -ErrorAction SilentlyContinue)
            if ($ResolvedPaths.Count -eq 0) {
                Write-Error "File not found: $Item"
                continue
            }

            foreach ($Resolved in $ResolvedPaths) {
                $FilePath = $Resolved.Path

                if (-not (Test-Path $FilePath -PathType Leaf)) {
                    Write-Error "Not a file: $FilePath"
                    continue
                }

                if ($Console -or $Raw) {
                    # ── Terminal mode ──
                    if ($Raw) {
                        Get-Content $FilePath -Raw
                        continue
                    }

                    if ($GlowPath) {
                        $GlowArgs = @($FilePath)
                        if ($Width -gt 0)      { $GlowArgs += @('-w', $Width) }
                        if ($Style -ne 'auto') { $GlowArgs += @('-s', $Style) }
                        try {
                            & $GlowPath @GlowArgs
                            if ($LASTEXITCODE -ne 0) { throw "glow exited with code $LASTEXITCODE" }
                        } catch {
                            Write-Warning "glow failed to render $FilePath : $_"
                            if ($PandocPath) {
                                Write-Warning 'Falling back to pandoc plain-text output'
                                if ($Width -gt 0) { $Cols = $Width } else { $Cols = 80 }
                                & $PandocPath $FilePath -t plain --wrap=auto "--columns=$Cols"
                            } else {
                                Write-Warning 'No fallback available — showing raw Markdown'
                                Get-Content $FilePath -Raw
                            }
                        }
                    }
                    elseif ($PandocPath) {
                        if ($Width -gt 0) { $Cols = $Width } else { $Cols = 80 }
                        & $PandocPath $FilePath -t plain --wrap=auto "--columns=$Cols"
                    }
                }
                else {
                    # ── Window mode: convert to HTML and open in browser ──
                    $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)
                    $TempHtml = Join-Path ([System.IO.Path]::GetTempPath()) "$BaseName-$(Get-Random).html"

                    $Title = $BaseName -replace '-', ' '
                    $StyleFile = Join-Path ([System.IO.Path]::GetTempPath()) "show-md-style-$(Get-Random).html"
                    try {
                        Write-Utf8NoBom -Path $StyleFile -Value $script:HtmlStyle  -ErrorAction Stop
                    } catch {
                        Write-Error "Failed to write style temp file: $_`nCheck that $([System.IO.Path]::GetTempPath()) is writable."
                        continue
                    }

                    $PandocArgs = @(
                        $FilePath
                        '-o', $TempHtml
                        '--standalone'
                        '--embed-resources'
                        '--metadata', "title=$Title"
                        '--include-in-header', $StyleFile
                    )

                    $PandocErrors = @()
                    & $PandocPath @PandocArgs 2>&1 | ForEach-Object {
                        if ($_ -match 'WARNING') { Write-Verbose "$_" }
                        elseif ($_ -is [System.Management.Automation.ErrorRecord]) { $PandocErrors += $_.ToString() }
                    }
                    Remove-Item $StyleFile -ErrorAction SilentlyContinue

                    if (Test-Path $TempHtml) {
                        # Open in default browser (returns immediately)
                        try {
                            if ($IsMacOS)       { & open $TempHtml }
                            elseif ($IsWindows) { & start $TempHtml }
                            else                { & xdg-open $TempHtml }
                        } catch {
                            Write-Warning "Could not open browser: $_`nHTML file saved at: $TempHtml — open it manually."
                        }
                        Write-Verbose "Opened: $TempHtml"
                    }
                    else {
                        if ($PandocErrors.Count -gt 0) { $ErrDetail = $PandocErrors -join '; ' } else { $ErrDetail = 'unknown reason' }
                        Write-Error "Failed to generate HTML for '$FilePath': $ErrDetail`nVerify the Markdown is valid: pandoc '$FilePath' -t plain | Select-Object -First 5"
                    }
                }
            }
        }
    }
}
