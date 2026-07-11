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
        [string]$PreviousPath
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # Build map: id -> @{ Statement (Trim'd); QuestionForm }. Preservation requires
    # BOTH id AND statement to match (t/1509 CL review) — otherwise the dedup
    # clustering may have re-assigned the id to a materially different crux, and
    # riding the old question_form along would be a silent semantic clobber.
    $ExistingQF = @{}
    if (Test-Path $PreviousPath) {
        try {
            $Existing = Get-Content -Raw $PreviousPath | ConvertFrom-Json
            if ($Existing.PSObject.Properties['cruxes'] -and $Existing.cruxes) {
                foreach ($EC in @($Existing.cruxes)) {
                    if (-not $EC.PSObject.Properties['id']) { continue }
                    if (-not $EC.PSObject.Properties['question_form']) { continue }
                    if (-not $EC.PSObject.Properties['statement']) { continue }
                    $Qf = [string]$EC.question_form
                    if ([string]::IsNullOrWhiteSpace($Qf)) { continue }
                    $ExistingQF[[string]$EC.id] = [PSCustomObject]@{
                        Statement    = ([string]$EC.statement).Trim()
                        QuestionForm = $Qf.Trim()
                    }
                }
            }
        } catch {
            Write-Warning "Merge-CruxQuestionForm: could not read $PreviousPath for preservation: $($_.Exception.Message)"
        }
    }

    $Preserved = 0; $Generated = 0; $Failed = 0
    foreach ($Crux in $Cruxes) {
        $CId = [string]$Crux.id
        if ($ExistingQF.ContainsKey($CId)) {
            $Prev = $ExistingQF[$CId]
            $CurStmt = ([string]$Crux.statement).Trim()
            if ($Prev.Statement -ceq $CurStmt) {
                $Crux['question_form'] = $Prev.QuestionForm
                $Preserved++
                continue
            }
            Write-Verbose "Merge-CruxQuestionForm: id ${CId} statement changed — falling through to regeneration"
        }
        $Stmt = [string]$Crux.statement
        if ([string]::IsNullOrWhiteSpace($Stmt)) { $Failed++; continue }
        $Type = if ($Crux.Contains('type')) { [string]$Crux.type } else { 'empirical' }

        try {
            $Res = Invoke-AIByUsage -UsageId 'enrichment.crux-question-form' -Values @{
                type      = $Type
                statement = $Stmt
            }
            if (-not $Res -or -not $Res.PSObject.Properties['Text']) {
                throw 'no Text field on Invoke-AIByUsage result (call failed)'
            }
            $Txt = [string]$Res.Text -replace '(?s)^\s*```(?:json)?\s*','' -replace '(?s)\s*```\s*$',''
            $Parsed = $Txt | ConvertFrom-Json
            $Q = if ($Parsed.PSObject.Properties['question']) { [string]$Parsed.question } else { '' }

            if (Test-CruxQuestionForm -Question $Q) {
                $Crux['question_form'] = $Q.Trim()
                $Generated++
            } else {
                Write-Verbose "Merge-CruxQuestionForm: validation failed for $CId (raw: $Q)"
                $Failed++
            }
        } catch {
            Write-Verbose "Merge-CruxQuestionForm: generation failed for ${CId}: $($_.Exception.Message)"
            $Failed++
        }
    }

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
