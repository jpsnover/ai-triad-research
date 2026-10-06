# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Resolve-BatchSummaryBackend {
    <#
    .SYNOPSIS
        Maps a model id to its AI backend name for Invoke-BatchSummary (t/3910).
    .DESCRIPTION
        Prefix match on the model id; an unrecognized prefix resolves to 'gemini',
        exactly as the inline chain in Invoke-BatchSummary did.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)][string]$Model)

    if     ($Model -match '^gemini') { return 'gemini' }
    elseif ($Model -match '^claude') { return 'claude' }
    elseif ($Model -match '^groq')   { return 'groq'   }
    elseif ($Model -match '^openai') { return 'openai' }
    return 'gemini'
}
