# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-FallacyInfo {
    <#
    .SYNOPSIS
        Opens the Wikipedia page for a logical fallacy in the default browser.
    .DESCRIPTION
        Looks up the given fallacy name in the built-in fallacy catalog and opens
        its Wikipedia article. Supports exact keys (e.g. "slippery_slope"),
        display names (e.g. "Slippery Slope"), or partial matches.

        When called without arguments, lists all known fallacies.

        When called with -Summary, also shows which taxonomy nodes have been
        flagged for that fallacy (requires prior Find-PossibleFallacy run).
    .PARAMETER Name
        The fallacy name to look up. Accepts exact catalog keys, display names,
        or partial text matches. Tab completion is supported.
    .PARAMETER List
        List all known fallacies in the catalog with their categories.
    .PARAMETER Summary
        After opening the browser, also display which taxonomy nodes have been
        flagged for this fallacy.
    .PARAMETER NoBrowser
        Display the URL without opening the browser.
    .PARAMETER RepoRoot
        Path to the repository root.
    .EXAMPLE
        Show-FallacyInfo slippery_slope
        # Opens https://en.wikipedia.org/wiki/Slippery_slope
    .EXAMPLE
        Show-FallacyInfo 'Straw Man'
        # Opens https://en.wikipedia.org/wiki/Straw_man
    .EXAMPLE
        Show-FallacyInfo -List
        # Lists all 59 fallacies in the catalog
    .EXAMPLE
        Show-FallacyInfo false_dilemma -Summary
        # Opens the Wikipedia page and shows which nodes were flagged
    .EXAMPLE
        Show-FallacyInfo cherry -NoBrowser
        # Matches "Cherry Picking", shows URL without opening browser
    #>
    [CmdletBinding(DefaultParameterSetName = 'Lookup')]
    param(
        [Parameter(Position = 0, ParameterSetName = 'Lookup')]
        [string]$Name,

        [Parameter(Mandatory, ParameterSetName = 'List')]
        [switch]$List,

        [Parameter(ParameterSetName = 'Lookup')]
        [switch]$Summary,

        [Parameter(ParameterSetName = 'Lookup')]
        [switch]$NoBrowser,

        [string]$RepoRoot = $script:RepoRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Load catalog ──
    $CatalogPath = Join-Path $script:ModuleRoot 'Private' 'fallacy-catalog.json'
    if (-not (Test-Path $CatalogPath)) {
        Write-Fail "Fallacy catalog not found: $CatalogPath"
        throw 'Fallacy catalog not found'
    }

    $Catalog = (Get-Content -Raw -Path $CatalogPath | ConvertFrom-Json -Depth 20).fallacies

    # ── List mode ──
    if ($List) {
        $Grouped = $Catalog | Group-Object -Property category
        foreach ($Group in $Grouped | Sort-Object Name) {
            $CategoryLabel = switch ($Group.Name) {
                'informal'       { 'Informal Fallacies' }
                'formal'         { 'Formal Fallacies' }
                'cognitive_bias' { 'Cognitive Biases' }
                default          { $Group.Name }
            }
            Write-Host "`n  $CategoryLabel" -ForegroundColor Cyan
            Write-Host "  $('─' * 50)" -ForegroundColor DarkGray
            foreach ($F in $Group.Group | Sort-Object display_name) {
                Write-Host "    $($F.display_name)" -ForegroundColor White -NoNewline
                Write-Host "  ($($F.name))" -ForegroundColor DarkGray
            }
        }
        Write-Host ''
        Write-Host "  $($Catalog.Count) fallacies in catalog" -ForegroundColor Green
        Write-Host ''
        return
    }

    # ── Lookup mode ──
    if (-not $Name) {
        Write-Info 'Usage: Show-FallacyInfo <fallacy-name>'
        Write-Info 'Run Show-FallacyInfo -List to see all known fallacies'
        return
    }

    # Try exact match on key
    $Match = $Catalog | Where-Object { $_.name -eq $Name }

    # Try exact match on display_name (case-insensitive)
    if (-not $Match) {
        $Match = $Catalog | Where-Object { $_.display_name -eq $Name }
    }

    # Try partial match on name or display_name
    if (-not $Match) {
        $Pattern = "*$Name*"
        $Match = @($Catalog | Where-Object {
            $_.name -like $Pattern -or $_.display_name -like $Pattern
        })
        if ($Match.Count -gt 1) {
            Write-Host "`n  Multiple matches for '$Name':" -ForegroundColor Yellow
            foreach ($M in $Match) {
                Write-Host "    $($M.display_name)" -ForegroundColor White -NoNewline
                Write-Host "  ($($M.name))" -ForegroundColor DarkGray
            }
            Write-Host ''
            Write-Info "Be more specific, or use the exact key in parentheses."
            return
        }
    }

    if (-not $Match -or ($Match -is [array] -and $Match.Count -eq 0)) {
        Write-Warn "No fallacy found matching '$Name'"
        Write-Info 'Run Show-FallacyInfo -List to see all known fallacies'
        return
    }

    # If array from Where-Object, take first
    if ($Match -is [array]) { $Match = $Match[0] }

    $WikiUrl = "https://en.wikipedia.org/wiki/$($Match.wiki)"

    Write-Host ''
    Write-Host "  $($Match.display_name)" -ForegroundColor Cyan
    Write-Host "  Category: $($Match.category)" -ForegroundColor DarkGray
    Write-Host "  $WikiUrl" -ForegroundColor White
    Write-Host ''

    if (-not $NoBrowser) {
        # Cross-platform browser open
        if     ($IsMacOS)   { Start-Process 'open' -ArgumentList $WikiUrl }
        elseif ($IsLinux)   { Start-Process 'xdg-open' -ArgumentList $WikiUrl }
        elseif ($IsWindows) { Start-Process $WikiUrl }
        else                { Start-Process $WikiUrl }  # fallback
    }

    # ── Summary: show which nodes are flagged for this fallacy ──
    if ($Summary) {
        Write-Host "  Taxonomy nodes flagged for $($Match.display_name):" -ForegroundColor Yellow
        Write-Host "  $('─' * 50)" -ForegroundColor DarkGray

        $TaxDir  = Get-TaxonomyDir
        $Found   = 0
        $PovKeys = @('accelerationist', 'safetyist', 'skeptic', 'situations')

        foreach ($PovKey in $PovKeys) {
            $FilePath = Join-Path $TaxDir "$PovKey.json"
            if (-not (Test-Path $FilePath)) { continue }

            $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json -Depth 20
            foreach ($Node in $FileData.nodes) {
                if (-not $Node.PSObject.Properties['graph_attributes']) { continue }
                if (-not $Node.graph_attributes.PSObject.Properties['possible_fallacies']) { continue }

                $NodeFallacies = @($Node.graph_attributes.possible_fallacies)
                $Flagged = @($NodeFallacies | Where-Object { $_.fallacy -eq $Match.name })
                if ($Flagged.Count -eq 0) { continue }

                foreach ($F in $Flagged) {
                    $ConfColor = switch ($F.confidence) {
                        'likely'     { 'Red' }
                        'possible'   { 'Yellow' }
                        'borderline' { 'DarkGray' }
                        default      { 'White' }
                    }
                    Write-Host "    $($Node.id)" -ForegroundColor White -NoNewline
                    Write-Host " [$($F.confidence)]" -ForegroundColor $ConfColor -NoNewline
                    Write-Host " $($Node.label)" -ForegroundColor DarkGray
                    Write-Host "      $($F.explanation)" -ForegroundColor DarkGray
                    $Found++
                }
            }
        }

        if ($Found -eq 0) {
            Write-Info '  No nodes flagged. Run Find-PossibleFallacy first.'
        }
        else {
            Write-Host ''
            Write-Host "  $Found node(s) flagged" -ForegroundColor Green
        }
        Write-Host ''
    }
}
