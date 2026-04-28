# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Builds a vocabulary constraints block for injection into summary extraction prompts.
# Loads standardized and colloquial terms from the dictionary directory and formats
# them as a prompt section listing display forms and bare terms to avoid.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Build-VocabularyBlock {
    [CmdletBinding()]
    [OutputType([string])]
    param()

    $DictDir = Join-Path (Get-DataRoot) 'dictionary'
    if (-not (Test-Path $DictDir)) {
        Write-Verbose "Build-VocabularyBlock: dictionary directory not found at $DictDir"
        return ''
    }

    $StdDir  = Join-Path $DictDir 'standardized'
    $CollDir = Join-Path $DictDir 'colloquial'

    # Load standardized terms grouped by camp
    $CampTerms = [ordered]@{ accelerationist = @(); safetyist = @(); skeptic = @() }
    if (Test-Path $StdDir) {
        foreach ($F in Get-ChildItem -Path $StdDir -Filter '*.json') {
            try {
                $Term = Get-Content -Raw -Path $F.FullName | ConvertFrom-Json
                $Camp = $Term.primary_camp_origin
                if ($CampTerms.Contains($Camp)) {
                    $CampTerms[$Camp] += $Term
                }
            }
            catch { Write-Verbose "Build-VocabularyBlock: failed to parse $($F.Name)" }
        }
    }

    $TotalTerms = ($CampTerms.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
    if ($TotalTerms -eq 0) {
        Write-Verbose 'Build-VocabularyBlock: no standardized terms found'
        return ''
    }

    # Load bare colloquial terms
    $BareTerms = @()
    if (Test-Path $CollDir) {
        foreach ($F in Get-ChildItem -Path $CollDir -Filter '*.json') {
            try {
                $Coll = Get-Content -Raw -Path $F.FullName | ConvertFrom-Json
                if ($Coll.status -eq 'do_not_use_bare') {
                    $BareTerms += $Coll.colloquial_term
                }
            }
            catch { }
        }
    }

    # Build the block
    $Lines = [System.Collections.Generic.List[string]]::new()
    $Lines.Add('')
    $Lines.Add('=== VOCABULARY CONSTRAINTS ===')
    $Lines.Add('Use standardized terms from the vocabulary below when writing key_point text,')
    $Lines.Add('descriptions, and unmapped concept labels. Do not use bare colloquial terms —')
    $Lines.Add('they are ambiguous across camps. Use the display form in prose.')
    $Lines.Add('')

    foreach ($Camp in $CampTerms.Keys) {
        $Terms = $CampTerms[$Camp] | Sort-Object { $_.canonical_form }
        if ($Terms.Count -eq 0) { continue }
        $Lines.Add("${Camp}:")
        foreach ($T in $Terms) {
            $Def = $T.definition
            if ($Def.Length -gt 100) { $Def = $Def.Substring(0, 97) + '...' }
            $Lines.Add("  $($T.canonical_form) -> `"$($T.display_form)`": $Def")
        }
        $Lines.Add('')
    }

    if ($BareTerms.Count -gt 0) {
        $Quoted = ($BareTerms | Sort-Object | ForEach-Object { "`"$_`"" }) -join ', '
        $Lines.Add("DO NOT USE BARE (ambiguous across camps): $Quoted")
        $Lines.Add('')
    }

    return ($Lines -join "`n")
}
