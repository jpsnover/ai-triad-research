# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepDocumentConversion {
    <#
    .SYNOPSIS
        Section 5 of Invoke-DependencyCheck (t/3910): pandoc / markitdown / pdftotext / mutool
        detection. Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][bool]$IsInstallMode,
        [Parameter(Mandatory)][bool]$Fix,
        [Parameter(Mandatory)][string]$Platform
    )

    Write-DepSection 'DOCUMENT CONVERSION (recommended)'

    if (Get-Command pandoc -ErrorAction SilentlyContinue) {
        try {
            $PandocVer = (pandoc --version 2>&1 | Select-Object -First 1) -replace 'pandoc ', ''
            $TestResult = '<p>Hello</p>' | pandoc -f html -t markdown_strict --wrap=none 2>&1
            if ($TestResult -match 'Hello') { Write-DepPass -Ctx $Ctx -Message "pandoc $PandocVer (smoke test passed)" }
            else { Write-DepWarn -Ctx $Ctx -Message "pandoc $PandocVer — conversion smoke test failed" }
        }
        catch { Write-DepWarn -Ctx $Ctx -Message "pandoc found but smoke test failed: $_" }
    }
    else {
        Write-DepWarn -Ctx $Ctx -Message 'pandoc not found — HTML/DOCX conversion will use basic fallback'
        if ($IsInstallMode) {
            Install-DependencyPackage -Ctx $Ctx -Fix $Fix -Platform $Platform -Name 'pandoc' -PackageNames @{
                brew = 'pandoc'; apt = 'pandoc'; dnf = 'pandoc'
                winget = 'JohnMacFarlane.Pandoc'; choco = 'pandoc'; scoop = 'pandoc'
            }
        }
    }

    if (Get-Command markitdown -ErrorAction SilentlyContinue) {
        try {
            $MidVer = (& markitdown --version 2>&1).Trim()
            Write-DepPass -Ctx $Ctx -Message "markitdown $MidVer (PDF, DOCX, PPTX, XLSX, HTML, images → Markdown)"
        }
        catch { Write-DepPass -Ctx $Ctx -Message 'markitdown available' }
    }
    else {
        Write-DepWarn -Ctx $Ctx -Message "markitdown not found — document conversion quality will be reduced"
        Write-DepSkip -Message "Install: pip install 'markitdown[all]'"
    }

    if (Get-Command pdftotext -ErrorAction SilentlyContinue) {
        try {
            $PdfVer = (pdftotext -v 2>&1 | Select-Object -First 1)
            Write-DepPass -Ctx $Ctx -Message "pdftotext available ($PdfVer) — PDF fallback"
        }
        catch { Write-DepPass -Ctx $Ctx -Message 'pdftotext available (PDF fallback)' }
    }
    elseif (Get-Command mutool -ErrorAction SilentlyContinue) {
        Write-DepPass -Ctx $Ctx -Message 'mutool available (PDF fallback)'
    }
    else {
        Write-DepSkip -Message 'pdftotext/mutool not found — markitdown handles PDF if installed'
    }
}
