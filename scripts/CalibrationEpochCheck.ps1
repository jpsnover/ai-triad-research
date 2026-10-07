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

function Get-EpochApiModelIds {
    # Registry id -> apiModelId from the config's `models` array. An epoch is the SERVED model,
    # `registryId:apiModelId` (t/4040, e/265#8), so a slot can change what it serves without its id changing.
    param([Parameter(Mandatory)]$Config)
    $Map = @{}
    if ($Config.PSObject.Properties['models']) {
        foreach ($M in @($Config.models)) {
            if ($M -and $M.PSObject.Properties['id'] -and $M.PSObject.Properties['apiModelId']) { $Map[[string]$M.id] = [string]$M.apiModelId }
        }
    }
    return $Map
}

function Get-EpochServedModel {
    # 'id:apiModelId' for a slot's registry id, or '' for an absent slot. An id with no models entry gives 'id:'.
    param([string]$Id, [hashtable]$ApiIds)
    if (-not $Id) { return '' }
    $Api = if ($ApiIds.ContainsKey($Id)) { $ApiIds[$Id] } else { '' }
    return "${Id}:$Api"
}

function Find-UnrecordedEpochChanges {
    <#
    .SYNOPSIS
        Every model slot whose SERVED model differs between the base and head configs (added and removed
        slots included) and has no matching §17 row. Returns { Slot; Old; New } in the form a row needs.
    .DESCRIPTION
        Two kinds of change (t/4041):
        - The slot's registry id changed: satisfied by a row with bare ids (Old → new = old id → new id), or
          by one written as `id:api`. Reported with bare ids.
        - The id is unchanged but `models[id].apiModelId` was repointed: satisfied only by an `id:api` row,
          since bare ids would read "x → x". Reported as `id:api`.
    #>
    param(
        [Parameter(Mandatory)]$BaseConfig,
        [Parameter(Mandatory)]$HeadConfig,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$RegisterRows
    )
    $Base = Get-EpochModelSlots -Config $BaseConfig
    $Head = Get-EpochModelSlots -Config $HeadConfig
    $BaseApi = Get-EpochApiModelIds -Config $BaseConfig
    $HeadApi = Get-EpochApiModelIds -Config $HeadConfig
    $Recorded = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($R in $RegisterRows) { [void]$Recorded.Add("$($R.Slot)|$($R.Old)|$($R.New)") }
    $AllSlots = @(@($Base.Keys) + @($Head.Keys) | Sort-Object -Unique)
    $Gaps = [System.Collections.Generic.List[object]]::new()
    foreach ($Slot in $AllSlots) {
        $Old = if ($Base.Contains($Slot)) { [string]$Base[$Slot] } else { '' }
        $New = if ($Head.Contains($Slot)) { [string]$Head[$Slot] } else { '' }
        $OldServed = Get-EpochServedModel -Id $Old -ApiIds $BaseApi
        $NewServed = Get-EpochServedModel -Id $New -ApiIds $HeadApi
        if ($OldServed -ceq $NewServed) { continue }
        if ($Recorded.Contains("$Slot|$OldServed|$NewServed")) { continue }
        if ($Old -cne $New) {
            if (-not $Recorded.Contains("$Slot|$Old|$New")) { $Gaps.Add([pscustomobject]@{ Slot = $Slot; Old = $Old; New = $New }) }
        }
        else {
            $Gaps.Add([pscustomobject]@{ Slot = $Slot; Old = $OldServed; New = $NewServed })
        }
    }
    return $Gaps.ToArray()
}
