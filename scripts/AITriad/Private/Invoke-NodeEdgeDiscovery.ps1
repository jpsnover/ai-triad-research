# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Per-node edge discovery API call, factored out for parallel execution support.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Invoke-NodeEdgeDiscovery {
    <#
    .SYNOPSIS
        Calls the AI API for a single node and returns raw discovery results.
    .DESCRIPTION
        Sends a pre-built prompt to the AI and parses the JSON response.
        Returns a result object with RawEdges, NewEdgeTypes, and error info.
        Validation (confidence threshold, target existence, dedup) is done
        by the caller so this function stays parallelizable.
    .PARAMETER Node
        The source taxonomy node (PSObject with .id property).
    .PARAMETER FullPrompt
        Complete prompt string (system + source node + candidate list + schema).
    .PARAMETER Model
        AI model ID.
    .PARAMETER ApiKey
        Resolved API key.
    .PARAMETER Temperature
        Sampling temperature. Default: 0.3.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSObject]$Node,
        [Parameter(Mandatory)][string]$FullPrompt,
        [Parameter(Mandatory)][string]$Model,
        [Parameter(Mandatory)][string]$ApiKey,
        [double]$Temperature = 0.3,
        [hashtable]$ResponseSchema
    )

    $Result = [PSCustomObject]@{
        NodeId       = $Node.id
        RawEdges     = @()
        NewEdgeTypes = @()
        Error        = $null
        ElapsedSec   = 0.0
    }

    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $AIParams = @{
            Prompt      = $FullPrompt
            Model       = $Model
            ApiKey      = $ApiKey
            Temperature = $Temperature
            MaxTokens   = 16384
            TimeoutSec  = 120
            JsonMode    = $true
        }
        if ($ResponseSchema) { $AIParams['ResponseSchema'] = $ResponseSchema }
        $Response = Invoke-AIApi @AIParams
    } catch {
        $Result.Error      = "API call failed: $_"
        $Result.ElapsedSec = [Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1)
        return $Result
    }
    $Stopwatch.Stop()
    $Result.ElapsedSec = [Math]::Round($Stopwatch.Elapsed.TotalSeconds, 1)

    # Strip markdown code fences if present
    $ResponseText = $Response.Text -replace '^\s*```json\s*', '' -replace '\s*```\s*$', ''

    $Discovery = $null
    try {
        $Discovery = $ResponseText | ConvertFrom-Json
    } catch {
        # Attempt JSON repair for truncated responses
        $Repaired = Repair-TruncatedJson -Text $ResponseText
        try {
            $Discovery = $Repaired | ConvertFrom-Json
        } catch {
            $Result.Error = 'JSON parse failed (repair also failed)'
            return $Result
        }
    }

    if ($Discovery.PSObject.Properties['edges'] -and $Discovery.edges) {
        $Result.RawEdges = @($Discovery.edges)
    }
    if ($Discovery.PSObject.Properties['new_edge_types'] -and $Discovery.new_edge_types) {
        $Result.NewEdgeTypes = @($Discovery.new_edge_types)
    }

    return $Result
}
