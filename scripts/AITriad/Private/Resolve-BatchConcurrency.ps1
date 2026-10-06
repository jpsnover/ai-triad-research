# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-BatchConcurrency {
    <#
    .SYNOPSIS
        The effective -MaxConcurrent for Invoke-BatchSummary (t/3910).
    .DESCRIPTION
        ForEach-Object -Parallel is PS 7+ only. The AITriad module supports Windows
        PowerShell 5.1 as a hard requirement (see AITriad.psd1), so on 5.1 this clamps to 1
        (with a WARN) and the sequential path runs instead. Also WARNs that -TimingTrace only
        reflects the main runspace when parallel workers are in use.
    #>
    [CmdletBinding()]
    [OutputType([int])]
    param(
        [Parameter(Mandatory)][int]$MaxConcurrent,
        [bool]$TimingEnabled
    )

    if ($MaxConcurrent -gt 1 -and $PSVersionTable.PSVersion.Major -lt 7) {
        Write-Warn "MaxConcurrent > 1 requires PowerShell 7+; falling back to sequential (MaxConcurrent = 1) on Windows PowerShell $($PSVersionTable.PSVersion)."
        $MaxConcurrent = 1
    }

    if ($TimingEnabled -and $MaxConcurrent -gt 1) {
        Write-Warn "-TimingTrace aggregates per-runspace; with -MaxConcurrent $MaxConcurrent the trace will only reflect the main runspace. Use -MaxConcurrent 1 for an accurate single-doc trace."
    }
    return $MaxConcurrent
}
