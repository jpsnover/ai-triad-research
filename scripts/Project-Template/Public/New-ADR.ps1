function New-ADR {
    <#
    .SYNOPSIS
        Scaffolds a new Architecture Decision Record from the project template.
    .DESCRIPTION
        Auto-numbers the new ADR by scanning existing files in docs/design/adr/,
        creates the file from the Nygard format template, and opens it for editing.
        The ADR directory and template file (000-template.md) must exist.
    .PARAMETER Title
        Short title for the decision (used in filename and header).
    .PARAMETER Author
        Author name. Defaults to the git user.name config.
    .PARAMETER Status
        Initial status. Default: 'proposed'.
    .PARAMETER ADRDir
        Override the ADR directory. Default: docs/design/adr/ relative to repo root.
    .PARAMETER NoOpen
        Skip opening the file after creation.
    .EXAMPLE
        New-ADR -Title 'Use ActionableError for all unrecoverable errors'
    .EXAMPLE
        New-ADR -Title 'Adopt ring buffer for diagnostics' -Author 'Jane Doe' -Status accepted
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Title,

        [Parameter()]
        [string]$Author,

        [Parameter()]
        [ValidateSet('proposed', 'accepted', 'deprecated')]
        [string]$Status = 'proposed',

        [Parameter()]
        [string]$ADRDir,

        [switch]$NoOpen
    )

    Set-StrictMode -Version Latest

    if (-not $ADRDir) {
        $ADRDir = Join-Path $script:RepoRoot 'docs/design/adr'
    }

    if (-not (Test-Path $ADRDir)) {
        New-ActionableError `
            -Goal 'Create new ADR' `
            -Problem "ADR directory not found: $ADRDir" `
            -Location 'New-ADR' `
            -NextSteps @(
                'Create the directory: New-Item -ItemType Directory -Path docs/design/adr'
                'Create a 000-template.md file with the Nygard format'
            ) -Throw
    }

    if (-not $Author) {
        try { $Author = (git config user.name 2>$null) } catch { }
        if (-not $Author) { $Author = $env:USERNAME ?? $env:USER ?? 'Unknown' }
    }

    # Find next ADR number
    $existing = Get-ChildItem -Path $ADRDir -Filter '*.md' |
        Where-Object { $_.BaseName -match '^\d{3}-' } |
        ForEach-Object { [int]($_.BaseName.Substring(0, 3)) } |
        Sort-Object -Descending |
        Select-Object -First 1

    $nextNum = if ($existing) { $existing + 1 } else { 1 }
    $numStr = $nextNum.ToString('000')

    # Build slug from title
    $slug = $Title.ToLower() -replace '[^a-z0-9\s-]', '' -replace '\s+', '-'
    if (-not $slug) { $slug = 'untitled' }
    if ($slug.Length -gt 60) { $slug = $slug.Substring(0, 60).TrimEnd('-') }
    $fileName = "$numStr-$slug.md"
    $filePath = Join-Path $ADRDir $fileName

    $date = (Get-Date).ToString('yyyy-MM-dd')

    $content = @"
# ADR-${numStr}: $Title

**Status:** $Status
**Date:** $date
**Author:** $Author

## Context

What is the issue that we're seeing that motivates this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?
"@

    Set-Content -Path $filePath -Value $content -Encoding utf8NoBOM
    Write-Output "Created: $filePath"

    if (-not $NoOpen) {
        if (Get-Command code -ErrorAction SilentlyContinue) {
            code $filePath
        } elseif ($IsWindows) {
            Start-Process notepad $filePath
        }
    }

    [PSCustomObject]@{
        Number   = $nextNum
        Title    = $Title
        Status   = $Status
        Author   = $Author
        Date     = $date
        FileName = $fileName
        Path     = $filePath
    }
}
