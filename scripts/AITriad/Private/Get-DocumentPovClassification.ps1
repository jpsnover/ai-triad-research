# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# CHESS pre-classification: lightweight LLM call to identify which POVs a document touches.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Get-DocumentPovClassification {
    <#
    .SYNOPSIS
        Lightweight CHESS pre-classification: identifies which POV camps a document touches.
    .DESCRIPTION
        Makes a fast, cheap AI call (~500 tokens in, ~100 out) to classify which POV
        camps a document is relevant to. Used to narrow the search space for
        Get-RelevantTaxonomyNodes — instead of searching all 518 nodes, search only
        the branches that matter.

        Returns an array of POV strings: @('accelerationist', 'safetyist', etc.)
        Always includes 'situations' as a catch-all safety margin per Risk Assessor.
    .PARAMETER QueryText
        Document excerpt for classification (title + first 500 words).
    .PARAMETER Model
        AI model. Default: gemini-3.1-flash-lite-preview (fast, cheap).
    .PARAMETER ApiKey
        API key.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$QueryText,

        [string]$Model = 'gemini-3.1-flash-lite-preview',

        [string]$ApiKey = ''
    )

    Set-StrictMode -Version Latest

    if ([string]::IsNullOrWhiteSpace($ApiKey)) {
        $ApiKey = Resolve-AIApiKey -ExplicitKey '' -Backend 'gemini'
    }

    if (-not $ApiKey) {
        Write-Verbose 'CHESS: No API key — returning all POVs'
        return @('accelerationist', 'safetyist', 'skeptic', 'situations')
    }

    $Prompt = @"
Classify which AI policy perspectives this document excerpt is relevant to.
Return a JSON object with a "perspectives" array containing applicable values from: "accelerationist", "safetyist", "skeptic".

Rules:
- Include a perspective if the document discusses, supports, critiques, or is relevant to that camp
- Most documents touch 2-3 perspectives
- If uncertain about a perspective, INCLUDE it (false positives are better than misses)
- Return at minimum 1 perspective

Document excerpt:
$($QueryText.Substring(0, [Math]::Min(2000, $QueryText.Length)))
"@

    $ClassificationSchema = @{
        type       = 'object'
        properties = @{
            perspectives = @{
                type  = 'array'
                items = @{ type = 'string'; enum = @('accelerationist', 'safetyist', 'skeptic') }
            }
        }
        required   = @('perspectives')
    }

    try {
        $Result = Invoke-AIApi -Prompt $Prompt -Model $Model -ApiKey $ApiKey `
            -Temperature 0.1 -MaxTokens 100 -ResponseSchema $ClassificationSchema -TimeoutSec 15

        if ($Result -and $Result.Text) {
            $CleanText = $Result.Text -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
            $Parsed = $CleanText.Trim() | ConvertFrom-Json
            $Povs = if ($Parsed.PSObject.Properties['perspectives']) { $Parsed.perspectives } else { @($Parsed) }
            $ValidPovs = @($Povs | Where-Object { $_ -in @('accelerationist', 'safetyist', 'skeptic') })

            if ($ValidPovs.Count -gt 0) {
                # Always include situations as catch-all safety margin
                $AllPovs = @($ValidPovs) + @('situations')
                Write-Verbose "CHESS classified: $($ValidPovs -join ', ')"
                return $AllPovs
            }
        }
    }
    catch {
        Write-Verbose "CHESS classification failed: $($_.Exception.Message) — using all POVs"
    }

    # Fallback: all POVs
    return @('accelerationist', 'safetyist', 'skeptic', 'situations')
}
