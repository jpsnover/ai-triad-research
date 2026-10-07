# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Calibration-epoch register check for verify:config (t/4037). Dot-sourced by Verify-Config.ps1 and the tests.
#
# Rule (CL, register §17, e/263): changing the model behind an ai-models.json `defaults[backend]` or
# `debateTiers.{tier}.{backend}` slot starts a calibration epoch, and the change needs a row in
# research/comp-linguist/docs/metric-provenance-register.md §17 whose Slot column is the dotted slot and
# whose "Old → new" cell matches. The t/3553 refresh tool writes that row; a hand edit of ai-models.json
# does not, which is the gap this check reports. WARN-ONLY until TL Gate Verification + Second Opinion
# (t/3361); Verify-Config keeps it out of the PASS/FAIL gate total.

function Get-EpochModelSlots {
    <#
    .SYNOPSIS
        Flattens ai-models.json's model slots into dotted-slot -> model id:
        `defaults.<backend>` and `debateTiers.<tier>.<backend>`. Keys starting with '_' (e.g. _comment)
        and non-object tiers are skipped.
    #>
    [OutputType([System.Collections.Specialized.OrderedDictionary])]
    param([Parameter(Mandatory)]$Config)
    $Slots = [ordered]@{}
    if ($Config.PSObject.Properties['defaults'] -and $Config.defaults) {
        foreach ($P in $Config.defaults.PSObject.Properties) {
            if ($P.Name -notlike '_*') { $Slots["defaults.$($P.Name)"] = [string]$P.Value }
        }
    }
    if ($Config.PSObject.Properties['debateTiers'] -and $Config.debateTiers) {
        foreach ($Tier in $Config.debateTiers.PSObject.Properties) {
            if ($Tier.Name -like '_*' -or $Tier.Value -isnot [pscustomobject]) { continue }
            foreach ($P in $Tier.Value.PSObject.Properties) {
                if ($P.Name -notlike '_*') { $Slots["debateTiers.$($Tier.Name).$($P.Name)"] = [string]$P.Value }
            }
        }
    }
    return $Slots
}

function ConvertTo-EpochCellValue {
    # A register cell or a missing slot, normalized: backticks and whitespace stripped; an empty or
    # placeholder cell ('—', '-', 'none', '(none)') means "no model" and becomes ''.
    param([AllowNull()][string]$Text)
    $T = ([string]$Text).Replace('`', '').Trim()
    if ($T -in @('', '—', '-', 'none', '(none)')) { return '' }
    return $T
}

function Get-EpochRegisterRows {
    <#
    .SYNOPSIS
        Parses the §17 epoch table out of the register markdown into { Slot; Old; New } rows. Only the
        table under the "## 17." heading is read, so other sections' tables can never satisfy the check.
        The placeholder row ("no epoch boundary recorded yet") parses to nothing usable and is ignored.
    #>
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Markdown)
    $Rows = [System.Collections.Generic.List[object]]::new()
    $InSection = $false
    foreach ($Line in ($Markdown -split "`r?`n")) {
        if ($Line -match '^##\s') { $InSection = $Line -match '^##\s+17\.'; continue }
        if (-not $InSection -or $Line -notmatch '^\s*\|') { continue }
        $Cells = @($Line.Trim().Trim('|') -split '\|' | ForEach-Object { $_.Trim() })
        if ($Cells.Count -lt 3 -or $Cells[1] -eq 'Slot' -or $Cells[1] -match '^-+$') { continue }
        $Parts = @($Cells[2] -split '\s*(?:→|->)\s*')
        if ($Parts.Count -ne 2) { continue }
        $Slot = ConvertTo-EpochCellValue $Cells[1]
        if (-not $Slot) { continue }
        $Rows.Add([pscustomobject]@{ Slot = $Slot; Old = (ConvertTo-EpochCellValue $Parts[0]); New = (ConvertTo-EpochCellValue $Parts[1]) })
    }
    return $Rows.ToArray()
}

function Find-UnrecordedEpochChanges {
    <#
    .SYNOPSIS
        Every model slot whose value differs between the base and head configs (added and removed slots
        included) and has no §17 row with the same Slot and the same Old → new. Returns { Slot; Old; New }.
    #>
    param(
        [Parameter(Mandatory)]$BaseConfig,
        [Parameter(Mandatory)]$HeadConfig,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$RegisterRows
    )
    $Base = Get-EpochModelSlots -Config $BaseConfig
    $Head = Get-EpochModelSlots -Config $HeadConfig
    $Recorded = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($R in $RegisterRows) { [void]$Recorded.Add("$($R.Slot)|$($R.Old)|$($R.New)") }
    $AllSlots = @(@($Base.Keys) + @($Head.Keys) | Sort-Object -Unique)
    $Gaps = [System.Collections.Generic.List[object]]::new()
    foreach ($Slot in $AllSlots) {
        $Old = if ($Base.Contains($Slot)) { [string]$Base[$Slot] } else { '' }
        $New = if ($Head.Contains($Slot)) { [string]$Head[$Slot] } else { '' }
        if ($Old -ceq $New) { continue }
        if (-not $Recorded.Contains("$Slot|$Old|$New")) {
            $Gaps.Add([pscustomobject]@{ Slot = $Slot; Old = $Old; New = $New })
        }
    }
    return $Gaps.ToArray()
}
