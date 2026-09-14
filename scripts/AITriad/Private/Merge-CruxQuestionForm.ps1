# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Preserve/generate the canonical question_form field on aggregated cruxes (t/1507, t/1509).
.DESCRIPTION
    Merges the question_form field onto each aggregated crux:
      1. Preserve — if the crux id exists in the previous OutputPath file, carry
         its question_form forward.
      2. Generate — for new cruxes, call the enrichment.crux-question-form UsageID,
         strip code fences, parse JSON, and validate (non-empty, single question,
         ends with '?', <=45 words). Failures leave the field absent so consumers
         fall back to statement — no invalid text is ever written.
    Mutates the crux dictionaries in place. Returns a stats object.
#>
function Merge-CruxQuestionForm {
    [CmdletBinding()]
    param(
        # Aggregated cruxes list — each element is an [ordered] hashtable with id / type / statement.
        [Parameter(Mandatory)]
        [object]$Cruxes,

        # Previous output file to preserve question_form from. Missing file = no preservation.
        [Parameter(Mandatory)]
        [string]$PreviousPath,

        # Optional run-scoped model override for the generation call (t/3478). Empty =
        # use the enrichment.crux-question-form usage default. Applied per-call via
        # -Override so the CL-owned usage default is never changed globally.
        [string]$Model = ''
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Build map: trimmed-statement -> question_form. Preservation keys on the
    # STATEMENT, not the crux id (t/3474): crux ids (crux-NNN) are assigned by
    # cluster order and renumber on every regen, so id-keyed preservation misses
    # en masse and forces needless AI regeneration. Keying on the statement still
    # honors the original t/1509 anti-clobber guard — a question_form is only ever
    # carried onto a crux whose statement is byte-identical (Trim-normalized) to the
    # one it was generated for, never across a materially changed statement.
    $ExistingQF = @{}
    if (Test-Path $PreviousPath) {
        try {
            $Existing = Get-Content -Raw $PreviousPath | ConvertFrom-Json
            if ($Existing.PSObject.Properties['cruxes'] -and $Existing.cruxes) {
                foreach ($EC in @($Existing.cruxes)) {
                    if (-not $EC.PSObject.Properties['question_form']) { continue }
                    if (-not $EC.PSObject.Properties['statement']) { continue }
                    $Qf = [string]$EC.question_form
                    if ([string]::IsNullOrWhiteSpace($Qf)) { continue }
                    $Key = ([string]$EC.statement).Trim()
                    if ([string]::IsNullOrWhiteSpace($Key)) { continue }
                    # First-wins on duplicate statements: dedup makes these rare, and
                    # identical statements yield the same question anyway.
                    if (-not $ExistingQF.ContainsKey($Key)) { $ExistingQF[$Key] = $Qf.Trim() }
                }
            }
        } catch {
            Write-Warning "Merge-CruxQuestionForm: could not read $PreviousPath for preservation: $($_.Exception.Message)"
        }
    }

    $Preserved = 0; $Generated = 0; $Failed = 0
    $Total = @($Cruxes).Count
    $Index = 0
    foreach ($Crux in $Cruxes) {
        $Index++
        # Progress: generation is a per-crux AI call, so a large regen can run long —
        # surface position so it's visibly advancing and never mistaken for a hang (t/3474).
        if ($Total -gt 0 -and ($Index % 25 -eq 0 -or $Index -eq $Total)) {
            Write-Progress -Id 51 -Activity 'Crux question_form (preserve/generate)' `
                -Status "$Index/$Total — preserved $Preserved, generated $Generated, failed $Failed" `
                -PercentComplete ([int](($Index / $Total) * 100))
        }

        $CId = [string]$Crux.id
        $CurStmt = ([string]$Crux.statement).Trim()

        # Preserve when the statement matches a previous crux's (id-independent, t/3474).
        if (-not [string]::IsNullOrWhiteSpace($CurStmt) -and $ExistingQF.ContainsKey($CurStmt)) {
            $Crux['question_form'] = $ExistingQF[$CurStmt]
            $Preserved++
            continue
        }

        $Stmt = [string]$Crux.statement
        if ([string]::IsNullOrWhiteSpace($Stmt)) { $Failed++; continue }
        $Type = if ($Crux.Contains('type')) { [string]$Crux.type } else { 'empirical' }

        try {
            $InvokeParams = @{
                UsageId = 'enrichment.crux-question-form'
                Values  = @{ type = $Type; statement = $Stmt }
            }
            # Run-scoped model override (t/3478): per-call only, never mutates the usage default.
            if (-not [string]::IsNullOrWhiteSpace($Model)) { $InvokeParams['Override'] = @{ model = $Model } }
            $Res = Invoke-AIByUsage @InvokeParams
            if (-not $Res -or -not $Res.PSObject.Properties['Text']) {
                throw 'no Text field on Invoke-AIByUsage result (call failed)'
            }
            $Txt = [string]$Res.Text -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
            $Parsed = $Txt | ConvertFrom-Json
            $Q = if ($Parsed.PSObject.Properties['question']) { [string]$Parsed.question } else { '' }

            if (Test-CruxQuestionForm -Question $Q) {
                $Crux['question_form'] = $Q.Trim()
                $Generated++
                # Periodic line so redirected/non-interactive logs (where Write-Progress
                # is invisible) still show the slow generation path advancing (t/3474).
                if ($Generated % 50 -eq 0) {
                    Write-Host ("  question_form: {0} generated so far ({1}/{2} cruxes processed)" -f $Generated, $Index, $Total)
                }
            } else {
                Write-Verbose "Merge-CruxQuestionForm: validation failed for $CId (raw: $Q)"
                $Failed++
            }
        } catch {
            Write-Verbose "Merge-CruxQuestionForm: generation failed for ${CId}: $($_.Exception.Message)"
            $Failed++
        }
    }
    if ($Total -gt 0) { Write-Progress -Id 51 -Activity 'Crux question_form (preserve/generate)' -Completed }

    [PSCustomObject]@{
        Preserved = $Preserved
        Generated = $Generated
        Failed    = $Failed
    }
}

<#
.SYNOPSIS
    Validate a candidate question_form string per t/1507 rules.
.DESCRIPTION
    Returns $true iff the string is non-empty, ends with '?', is a single question
    (only one '?' after trim), and is <=45 words (35 target, 45 tolerance).
    Mirrors research/comp-linguist/_cruxq_run.ps1 Test-ValidQuestion so the two
    call sites stay consistent.
#>
function Test-CruxQuestionForm {
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$Question
    )
    if ([string]::IsNullOrWhiteSpace($Question)) { return $false }
    $Q = $Question.Trim()
    if (-not $Q.EndsWith('?')) { return $false }
    if (@($Q -split '\s+').Count -gt 45) { return $false }
    if (@($Q -split '\?').Count -gt 2) { return $false }
    return $true
}
