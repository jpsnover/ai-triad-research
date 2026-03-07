# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Version 7.0
<#
.SYNOPSIS
    Post-processing for raw pdftotext output.
.DESCRIPTION
    Strips layout artifacts (filler lines, excess indentation, hyphenated
    line breaks, excessive blank lines) from pdftotext output.
    Separated into its own module to keep DocConverters.psm1 under the
    AMSI pattern-density threshold.
#>

function Optimize-PdfText {
    param([Parameter(Mandatory)][string]$RawText)

    # 1. Split into lines
    $Lines = $RawText -split '\r?\n'

    # 2. Strip pure-artifact lines (only dots, dashes, underscores, page numbers)
    $Lines = $Lines | Where-Object {
        $Trimmed = $_.Trim()
        if ($Trimmed -eq '') { return $true }
        if ($Trimmed -match '^[\.\-_\|=\s]+$') { return $false }
        if ($Trimmed -match '^\-?\s*\d{1,4}\s*\-?$') { return $false }
        return $true
    }

    # 3. Remove common leading whitespace (de-indent)
    $NonBlankLines = $Lines | Where-Object { $_.Trim() -ne '' }
    if ($NonBlankLines.Count -gt 0) {
        $MinIndent = ($NonBlankLines | ForEach-Object {
            ($_ -match '^(\s*)') | Out-Null
            $Matches[1].Length
        } | Measure-Object -Minimum).Minimum
        if ($MinIndent -gt 0) {
            $Lines = $Lines | ForEach-Object {
                if ($_.Length -ge $MinIndent) { $_.Substring($MinIndent) } else { $_ }
            }
        }
    }

    # 4. Join hyphenated words across line breaks
    $Joined = ($Lines -join "`n")
    $Joined = [regex]::Replace($Joined, '(\w)-\s*\n\s*(\w)', '$1$2')

    # 5. Collapse 3+ consecutive blank lines to 2
    $Joined = [regex]::Replace($Joined, '(\r?\n){3,}', "`n`n")
    $Joined = $Joined.Trim()

    return $Joined
}

Export-ModuleMember -Function Optimize-PdfText
