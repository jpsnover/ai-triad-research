# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# SHA-256 of a string as lowercase hex (64 chars). Used for the per-container
# `text_sha256` idempotency + supersession guard in entity_mentions.json
# (t/1894, contract lib/entities/mentionTypes.ts). Hash is over the UTF-8 bytes
# of the EXACT analyzed text — the writer and any read-path consumer must hash
# the same reconstructed text for the guard to hold. Dot-sourced — do NOT export.
function Get-TextSha256 {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text
    )
    Set-StrictMode -Version Latest
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return -join ($hash | ForEach-Object { $_.ToString('x2') })
    }
    finally {
        $sha.Dispose()
    }
}
