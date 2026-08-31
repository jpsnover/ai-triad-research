# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Single source of truth for the v2 entity-vector SOURCE TEXTS + staleness fingerprint
# (t/3121). BOTH writers — Import-Entity (per-approval) and Update-EntityEmbeddings (bulk
# backfill) — call this so the `_src_hash` they compute is byte-identical; two divergent
# hash constructions would make the staleness guard mis-fire (the t/3085 class). The name
# text embeds label + aliases (resolution-ladder cosine tie-break); the description text
# embeds the description. The hash is over "<nameText>\n<descText>" of the UTF-8 bytes.
# Dot-sourced — do NOT export.
function Get-EntityVectorSource {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Name,

        [Parameter()]
        [string[]]$Aliases = @(),

        [Parameter()]
        [AllowEmptyString()]
        [string]$Description = ''
    )
    Set-StrictMode -Version Latest
    $aliasText = @($Aliases) -join ' '
    $nameText  = if ($aliasText) { "$Name $aliasText" } else { [string]$Name }
    $descText  = [string]$Description
    return @{
        NameText = $nameText
        DescText = $descText
        SrcHash  = Get-TextSha256 -Text "$nameText`n$descText"
    }
}
