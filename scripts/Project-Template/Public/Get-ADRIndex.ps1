function Get-ADRIndex {
    <#
    .SYNOPSIS
        Parses all Architecture Decision Records and returns a structured index.
    .DESCRIPTION
        Reads every ADR file in docs/design/adr/, extracts metadata (number, title,
        status, date, author), and returns a sorted list. Useful for quarterly ADR
        reviews and checking which decisions are still active.
    .PARAMETER ADRDir
        Override the ADR directory. Default: docs/design/adr/ relative to repo root.
    .PARAMETER Status
        Filter by status (proposed, accepted, deprecated, superseded).
    .EXAMPLE
        Get-ADRIndex
    .EXAMPLE
        Get-ADRIndex -Status accepted | Format-Table
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$ADRDir,

        [Parameter()]
        [ValidateSet('proposed', 'accepted', 'deprecated', 'superseded', '')]
        [string]$Status
    )

    Set-StrictMode -Version Latest

    if (-not $ADRDir) {
        $ADRDir = Join-Path $script:RepoRoot 'docs/design/adr'
    }

    if (-not (Test-Path $ADRDir)) {
        Write-Warning "ADR directory not found: $ADRDir"
        return
    }

    $adrs = [System.Collections.Generic.List[object]]::new()

    foreach ($file in (Get-ChildItem -Path $ADRDir -Filter '*.md' | Sort-Object Name)) {
        if ($file.BaseName -eq '000-template') { continue }
        if ($file.BaseName -notmatch '^\d{3}-') { continue }

        $number = [int]$file.BaseName.Substring(0, 3)
        $title = $null
        $adrStatus = $null
        $date = $null
        $author = $null

        $lineCount = 0
        foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
            $lineCount++
            if ($lineCount -gt 20) { break }

            if ($line -match '^#\s+ADR-\d+:\s+(.+)$') {
                $title = $Matches[1].Trim()
            }
            elseif ($line -match '\*\*Status:\*\*\s*(.+)') {
                $adrStatus = $Matches[1].Trim()
            }
            elseif ($line -match '\*\*Date:\*\*\s*(.+)') {
                $date = $Matches[1].Trim()
            }
            elseif ($line -match '\*\*Author:\*\*\s*(.+)') {
                $author = $Matches[1].Trim()
            }
        }

        if (-not $title) { $title = $file.BaseName.Substring(4) -replace '-', ' ' }

        $adr = [PSCustomObject]@{
            Number   = $number
            Title    = $title
            Status   = $adrStatus ?? 'unknown'
            Date     = $date
            Author   = $author
            FileName = $file.Name
            Path     = $file.FullName
        }

        if (-not $Status -or $adr.Status -eq $Status) {
            $adrs.Add($adr)
        }
    }

    $adrs | Sort-Object Number
}
