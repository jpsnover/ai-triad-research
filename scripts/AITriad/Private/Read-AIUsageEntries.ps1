# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Read-AIUsageEntries {
    <#
    .SYNOPSIS
        Get-AICostReport sub-helper (t/3910): parses usage-summary.jsonl files
        into filtered entries.
    .DESCRIPTION
        A malformed JSON line is silently skipped (pre-existing behavior,
        preserved verbatim -- not changed by this refactor).
    .PARAMETER UsageFiles
        Files to read (as returned by Find-AIUsageFiles).
    .PARAMETER After
        Include only entries after this date.
    .PARAMETER Before
        Include only entries before this date.
    .PARAMETER Backend
        Filter to specific backends.
    .OUTPUTS
        [System.Collections.Generic.List[PSObject]]
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param(
        [Parameter(Mandatory)]
        [System.IO.FileInfo[]]$UsageFiles,

        # Untyped (not [datetime]): Get-AICostReport's own -After/-Before are
        # [datetime] with no default, so when the caller omits them they hold
        # $null in that scope -- forwarding $null to a [datetime]-typed
        # parameter here would throw at the call boundary ("Cannot convert
        # null to type System.DateTime"), even though holding $null in a
        # same-scope typed variable never does.
        $After,

        $Before,

        [string[]]$Backend
    )

    Set-StrictMode -Version Latest

    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($File in $UsageFiles) {
        $SessionName = $File.Directory.Name
        foreach ($Line in (Get-Content $File.FullName)) {
            if ([string]::IsNullOrWhiteSpace($Line)) { continue }
            try {
                $Entry = $Line | ConvertFrom-Json
                $Entry | Add-Member -NotePropertyName 'session' -NotePropertyValue $SessionName -Force -ErrorAction SilentlyContinue

                $Ts = $null
                if ($Entry.PSObject.Properties['ts']) {
                    try { $Ts = [datetime]::Parse($Entry.ts) } catch { }
                }

                if ($After -and $Ts -and $Ts -lt $After) { continue }
                if ($Before -and $Ts -and $Ts -ge $Before) { continue }
                if ($Backend -and $Entry.PSObject.Properties['backend'] -and $Entry.backend -notin $Backend) { continue }

                $Entry | Add-Member -NotePropertyName 'parsedTs' -NotePropertyValue $Ts -Force -ErrorAction SilentlyContinue
                $Entries.Add($Entry)
            }
            catch { }
        }
    }

    # -NoEnumerate: a plain `return $Entries` lets PowerShell's pipeline
    # auto-enumerate the List -- for a List with 0 or 1 element that unrolls
    # to nothing / a single bare object instead of the List itself, so the
    # caller's assignment silently loses the collection (0 elements -> $null,
    # breaking a later .Count). -NoEnumerate passes the List through as one object.
    Write-Output -NoEnumerate $Entries
}
