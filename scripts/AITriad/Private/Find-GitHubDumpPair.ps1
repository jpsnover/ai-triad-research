# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Pair-discovery helper for Get-AzureFlightRecorder -Merged (t/1377).
# Extracted to Private/ so the two-scheme + orphan matrix is directly unit-testable
# without mocking gh / GitHub / Merge-FlightRecorderDumps.

<#
.SYNOPSIS
    Resolves the client + server flight-recorder dump pair for a DumpId across
    both naming schemes present in the data repo.
.DESCRIPTION
    - Paired (preferred):  client-{DumpId}.jsonl + server-{DumpId}.jsonl
    - Legacy:              flight-recorder-{DumpId}.jsonl + server-flight-recorder-{DumpId}.jsonl

    Returns a PSCustomObject with { DumpId, Scheme, Client, Server }. Either
    Client or Server may be $null (orphan) — Merge-FlightRecorderDumps handles
    single-side merges gracefully, so this helper never throws for orphans.
    Prefers paired-scheme when EITHER side matches; falls back to legacy
    otherwise. If both schemes are absent, returns Client=$null, Server=$null.
.PARAMETER DumpId
    Correlation ID (e.g. 'a1b2c3d4' or a timestamp string).
.PARAMETER Files
    Enumerable of file descriptor objects, each having a `.name` property (the
    same shape produced by Get-GitHubDumpList / gh api contents).
#>
function Find-GitHubDumpPair {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$DumpId,
        [Parameter()][object]$Files
    )
    # Strict-mode .Count guard — @()-wrap every Where-Object pipeline
    # (TL condition p/174#1). Also filter out null entries: @($null) is a
    # 1-element array containing $null, which trips strict-mode property
    # access inside Where-Object even before .Count is read.
    $items = @($Files) | Where-Object { $null -ne $_ }
    $items = @($items)
    $escaped = [regex]::Escape($DumpId)

    # Paired-scheme match
    $pairedClient = @($items | Where-Object { $_.name -eq "client-$DumpId.jsonl" })
    $pairedServer = @($items | Where-Object { $_.name -eq "server-$DumpId.jsonl" })

    # Legacy-scheme match — anchored with ^...$ so server- doesn't leak to client.
    $legacyClient = @($items | Where-Object { $_.name -match "^flight-recorder-$escaped\.jsonl$" })
    $legacyServer = @($items | Where-Object { $_.name -match "^server-flight-recorder-$escaped\.jsonl$" })

    $scheme = if (@($pairedClient).Count -gt 0 -or @($pairedServer).Count -gt 0) { 'paired' } else { 'legacy' }
    $clientMatch = if ($scheme -eq 'paired' -and @($pairedClient).Count -gt 0) { $pairedClient[0] }
                   elseif ($scheme -eq 'legacy' -and @($legacyClient).Count -gt 0) { $legacyClient[0] }
                   else { $null }
    $serverMatch = if ($scheme -eq 'paired' -and @($pairedServer).Count -gt 0) { $pairedServer[0] }
                   elseif ($scheme -eq 'legacy' -and @($legacyServer).Count -gt 0) { $legacyServer[0] }
                   else { $null }

    [PSCustomObject]@{
        DumpId = $DumpId
        Scheme = $scheme
        Client = $clientMatch
        Server = $serverMatch
    }
}
