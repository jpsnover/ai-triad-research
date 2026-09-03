# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Concept {
    <#
    .SYNOPSIS
        Read the standardized dictionary (concepts, `term:*`) and query the concept↔node grounding map.
    .DESCRIPTION
        The PowerShell reader for the standardized dictionary (t/3291). Concepts are TS-first
        (`lib/dictionary/DictionaryLoader`); this cmdlet gives PS/CLI callers object access to the
        same on-disk data under `<dataRoot>/dictionary/standardized/*.json` (and, with
        -IncludeColloquial, `<dataRoot>/dictionary/colloquial/*.json`).

        Emits one object per matching term (never text). Filters compose (AND): -Slug, -Camp,
        -Status, -UsedByNode. -UsedByNode is the reverse concept↔BDI query — it returns the concepts
        that ground a given node, read from each term's `used_by_nodes[]` (single-source; no taxonomy
        load required).
    .PARAMETER Slug
        A concept canonical form — `"risk_existential"` or the prefixed `"term:risk_existential"`
        (the `term:` prefix is stripped). Omit to return all concepts. Case-insensitive exact match.
    .PARAMETER Camp
        Filter by originating camp. Accepts the short codes `acc` / `saf` / `skp` (mapped to the
        stored `primary_camp_origin` = accelerationist / safetyist / skeptic).
    .PARAMETER Status
        Filter by coinage status: accepted / provisional / contested / deprecated.
    .PARAMETER UsedByNode
        Return only concepts whose `used_by_nodes[]` contains this BDI node id (e.g. `skp-beliefs-001`).
        The direct reverse concept↔node query.
    .PARAMETER IncludeColloquial
        Also emit the colloquial terms (`Kind = 'colloquial'`). Colloquial entries have a different
        source schema — only the fields that map are populated (see .OUTPUTS); `ResolvesTo` carries
        their standardized targets.
    .PARAMETER DictionaryRoot
        Override the dictionary directory (fixtures/tests). Default: `<dataRoot>/dictionary`, with
        `<dataRoot>` resolved by the standard priority (env `AI_TRIAD_DATA_ROOT` > `.aitriad.json` >
        monorepo fallback) via Get-DataRoot. Never hardcoded.
    .OUTPUTS
        [pscustomobject] per term: CanonicalForm, DisplayForm, Definition, Camp, Status,
        UsedByNodes[], CharacteristicPhrases[], SeeAlso[], CoinedAt, CoinedBy, Kind
        ('standardized' | 'colloquial'), ResolvesTo[] (colloquial only; else empty).
    .EXAMPLE
        Get-Concept
        All 54 standardized concepts as objects.
    .EXAMPLE
        Get-Concept -Slug term:risk_existential
        The single concept `risk_existential` (prefix tolerated).
    .EXAMPLE
        Get-Concept -UsedByNode skp-beliefs-001
        The concepts that ground BDI node skp-beliefs-001 (reverse map).
    .EXAMPLE
        Get-Concept -Camp skp -Status accepted | Select-Object CanonicalForm, DisplayForm
        Accepted skeptic-origin concepts, projected to two fields.
    .LINK
        Get-Entity
    .LINK
        Show-AITriadHelp
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Position = 0)]
        [string]$Slug,

        [Parameter()]
        [ValidateSet('acc', 'saf', 'skp')]
        [string]$Camp,

        [Parameter()]
        [ValidateSet('accepted', 'provisional', 'contested', 'deprecated')]
        [string]$Status,

        [Parameter()]
        [string]$UsedByNode,

        [Parameter()]
        [switch]$IncludeColloquial,

        [Parameter()]
        [string]$DictionaryRoot
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $dictRoot = if ($DictionaryRoot) { $DictionaryRoot } else { Join-Path (Get-DataRoot) 'dictionary' }
    $stdDir   = Join-Path $dictRoot 'standardized'

    if (-not (Test-Path -LiteralPath $stdDir)) {
        throw (New-ActionableError -PassThru `
                -Goal 'Read the standardized dictionary (concepts)' `
                -Problem "Standardized dictionary directory not found: $stdDir" `
                -Location 'Get-Concept' `
                -NextSteps @(
                    "Confirm the data root is correct (env AI_TRIAD_DATA_ROOT / .aitriad.json) and that '$stdDir' exists",
                    'Pass -DictionaryRoot to point at a dictionary directory explicitly (fixtures/tests)'
                ))
    }

    # Normalize the -Slug filter once: tolerate a leading 'term:' and compare case-insensitively.
    $slugFilter = ''
    if ($PSBoundParameters.ContainsKey('Slug') -and $Slug) {
        $slugFilter = ($Slug -replace '^term:', '').Trim().ToLowerInvariant()
    }

    # acc/saf/skp -> the full primary_camp_origin value stored on disk.
    $campMap  = @{ acc = 'accelerationist'; saf = 'safetyist'; skp = 'skeptic' }
    $campFull = if ($Camp) { $campMap[$Camp] } else { '' }

    $prop = { param($o, $name, $default)
        if ($o.PSObject.Properties[$name]) { $o.$name } else { $default }
    }

    $results = [System.Collections.Generic.List[object]]::new()

    # ── Standardized terms ────────────────────────────────────────────────────────────────
    # Loop bodies use a positive `$keep` guard and NEVER `continue`: a `continue` inside a function
    # invoked from a Pester It can escape to Pester's own block loop (issue #2669) and silently abort
    # the run. Loop-locals are named $termCamp/$termStatus (not $camp/$status) because PS variable
    # names are case-insensitive — `$camp = 'accelerationist'` would re-validate the ValidateSet
    # parameter $Camp against its set and throw.
    $stdFiles = @(Get-ChildItem -LiteralPath $stdDir -Filter '*.json' -File | Sort-Object -Property Name)
    foreach ($file in $stdFiles) {
        $term = $null
        try { $term = Get-Content -Raw -LiteralPath $file.FullName -Encoding utf8 | ConvertFrom-Json }
        catch { Write-Warning "Get-Concept: skipping unparseable dictionary file '$($file.Name)' ($($_.Exception.Message))." }

        if ($null -ne $term) {
            $canonical  = [string](& $prop $term 'canonical_form' '')
            $termCamp   = [string](& $prop $term 'primary_camp_origin' '')
            $termStatus = [string](& $prop $term 'coinage_status' '')
            $usedBy     = @(& $prop $term 'used_by_nodes' @())

            $keep = $true
            if ($slugFilter -and $canonical.ToLowerInvariant() -ne $slugFilter) { $keep = $false }
            if ($campFull   -and $termCamp   -ne $campFull) { $keep = $false }
            if ($Status     -and $termStatus -ne $Status)   { $keep = $false }
            if ($PSBoundParameters.ContainsKey('UsedByNode') -and $UsedByNode -and ($usedBy -notcontains $UsedByNode)) { $keep = $false }

            if ($keep) {
                $results.Add([pscustomobject]@{
                        CanonicalForm         = $canonical
                        DisplayForm           = [string](& $prop $term 'display_form' '')
                        Definition            = [string](& $prop $term 'definition' '')
                        Camp                  = $termCamp
                        Status                = $termStatus
                        UsedByNodes           = $usedBy
                        CharacteristicPhrases = @(& $prop $term 'characteristic_phrases' @())
                        SeeAlso               = @(& $prop $term 'see_also' @())
                        CoinedAt              = [string](& $prop $term 'coined_at' '')
                        CoinedBy              = [string](& $prop $term 'coined_by' '')
                        Kind                  = 'standardized'
                        ResolvesTo            = @()
                    })
            }
        }
    }

    # ── Colloquial terms (opt-in; different source schema) ─────────────────────────────────
    if ($IncludeColloquial) {
        $colDir = Join-Path $dictRoot 'colloquial'
        if (Test-Path -LiteralPath $colDir) {
            $colFiles = @(Get-ChildItem -LiteralPath $colDir -Filter '*.json' -File | Sort-Object -Property Name)
            foreach ($file in $colFiles) {
                $term = $null
                try { $term = Get-Content -Raw -LiteralPath $file.FullName -Encoding utf8 | ConvertFrom-Json }
                catch { Write-Warning "Get-Concept: skipping unparseable colloquial file '$($file.Name)' ($($_.Exception.Message))." }

                if ($null -ne $term) {
                    $canonical  = [string](& $prop $term 'colloquial_term' '')
                    $termStatus = [string](& $prop $term 'status' '')
                    $resolves   = @(& $prop $term 'resolves_to' @())

                    # Colloquial terms carry no camp / used_by / characteristic-phrase data — a
                    # -Camp or -UsedByNode filter can never match one, so exclude when either is set.
                    $keep = $true
                    if ($slugFilter -and $canonical.ToLowerInvariant() -ne $slugFilter) { $keep = $false }
                    if ($campFull) { $keep = $false }
                    if ($Status -and $termStatus -ne $Status) { $keep = $false }
                    if ($PSBoundParameters.ContainsKey('UsedByNode') -and $UsedByNode) { $keep = $false }

                    if ($keep) {
                        $results.Add([pscustomobject]@{
                                CanonicalForm         = $canonical
                                DisplayForm           = $canonical
                                Definition            = ''
                                Camp                  = ''
                                Status                = $termStatus
                                UsedByNodes           = @()
                                CharacteristicPhrases = @()
                                SeeAlso               = $resolves
                                CoinedAt              = [string](& $prop $term 'first_added' '')
                                CoinedBy              = ''
                                Kind                  = 'colloquial'
                                ResolvesTo            = $resolves
                            })
                    }
                }
            }
        }
        else {
            Write-Warning "Get-Concept: -IncludeColloquial set but no colloquial directory at '$colDir'."
        }
    }

    return $results.ToArray()
}
