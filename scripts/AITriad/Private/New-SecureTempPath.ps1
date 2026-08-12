# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-SecureTempPath {
    <#
    .SYNOPSIS
        Returns an unpredictable temp-file path to defeat symlink/pre-creation attacks.
    .DESCRIPTION
        A fixed temp filename (e.g. AITriad-Help.html) lets a local attacker
        pre-create that path — as a symlink to a sensitive file, for example —
        so a later write lands on an attacker-chosen target (arbitrary write).
        This builds a path whose filename carries a cryptographically-random
        component (via [System.IO.Path]::GetRandomFileName, RNG-backed), so the
        name cannot be guessed or pre-created ahead of the write.

        Returns the path only; it does not create the file.
    .PARAMETER Prefix
        Leading filename token (default 'AITriad').
    .PARAMETER Extension
        File extension, with or without a leading dot (default 'tmp').
    .EXAMPLE
        $TempPath = New-SecureTempPath -Prefix 'AITriad-Help' -Extension 'html'
    #>
    [CmdletBinding()]
    param(
        [string]$Prefix = 'AITriad',
        [string]$Extension = 'tmp'
    )

    Set-StrictMode -Version Latest

    # GetRandomFileName yields 8 cryptographically-random chars + '.' + 3 more.
    $rand = [System.IO.Path]::GetRandomFileName().Replace('.', '')
    $ext  = $Extension.TrimStart('.')
    $name = "$Prefix-$rand.$ext"
    return (Join-Path ([System.IO.Path]::GetTempPath()) $name)
}
