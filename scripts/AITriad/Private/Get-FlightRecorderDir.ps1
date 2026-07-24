# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-FlightRecorderDir {
    <#
    .SYNOPSIS
        Resolves the default Taxonomy Editor flight-recorder dump directory for
        the current OS (Electron userData layout).
    .DESCRIPTION
        Single source of the per-OS flight-recorder path, shared by the
        flight-recorder cmdlets (Get-FlightRecorderDump, Merge-FlightRecorderDumps,
        Get-LatestFlightRecorderDump) so the layout is defined in exactly one
        place (t/1712 — Shared Utility Rule). Returns the base directory only;
        callers may layer their own overrides on top (e.g. Merge-FlightRecorderDumps
        prefers an admin/ paired subdir when present). The path is not guaranteed
        to exist — callers Test-Path as needed.
    .OUTPUTS
        [string] Absolute flight-recorder directory path for the current OS.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    if ($IsWindows) {
        return (Join-Path $env:APPDATA 'taxonomy-editor/flight-recorder')
    } elseif ($IsMacOS) {
        return (Join-Path $HOME 'Library/Application Support/taxonomy-editor/flight-recorder')
    } else {
        return (Join-Path $HOME '.config/taxonomy-editor/flight-recorder')
    }
}
