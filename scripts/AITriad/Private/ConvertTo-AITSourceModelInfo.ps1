# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function ConvertTo-AITSourceModelInfo {
    <#
    .SYNOPSIS
        Hydrates the ModelInfo object from a summary's model_info or legacy ai_model field
        (t/3910 decomposition of Get-AITSource, no behavior change).
    .PARAMETER Summary
        The parsed summary JSON object, or $null if none exists / failed to parse.
    .OUTPUTS
        [PSCustomObject] or $null when Summary is $null.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param([AllowNull()][PSObject]$Summary)
    Set-StrictMode -Version Latest

    if ($null -eq $Summary) { return $null }

    $MInfo = [PSCustomObject]@{
        Model = $null; Temperature = 0; MaxTokens = 0; ExtractionMode = $null
        TaxonomyFilter = $null; TaxonomyNodes = 0; FireConfidenceThreshold = 0
        Chunked = $false; ChunkCount = 0; FireStats = $null
    }
    $SP = $Summary.PSObject.Properties
    if ($SP['model_info']) {
        $Mi = $Summary.model_info
        $Mp = $Mi.PSObject.Properties
        $MInfo.Model                   = if ($Mp['model'])                    { $Mi.model }                    else { $null }
        $MInfo.Temperature             = if ($Mp['temperature'])              { $Mi.temperature }              else { 0 }
        $MInfo.MaxTokens               = if ($Mp['max_tokens'])               { $Mi.max_tokens }               else { 0 }
        $MInfo.ExtractionMode          = if ($Mp['extraction_mode'])          { $Mi.extraction_mode }          else { $null }
        $MInfo.TaxonomyFilter          = if ($Mp['taxonomy_filter'])          { $Mi.taxonomy_filter }          else { $null }
        $MInfo.TaxonomyNodes           = if ($Mp['taxonomy_nodes'])           { $Mi.taxonomy_nodes }           else { 0 }
        $MInfo.FireConfidenceThreshold = if ($Mp['fire_confidence_threshold']) { $Mi.fire_confidence_threshold } else { 0 }
        $MInfo.Chunked                 = if ($Mp['chunked'])                  { $Mi.chunked }                  else { $false }
        $MInfo.ChunkCount              = if ($Mp['chunk_count'])              { $Mi.chunk_count }              else { 0 }
        $MInfo.FireStats               = if ($Mp['fire_stats'])               { $Mi.fire_stats }               else { $null }
    }
    elseif ($SP['ai_model']) {
        # Legacy format
        $MInfo.Model       = $Summary.ai_model
        $MInfo.Temperature = if ($SP['temperature']) { $Summary.temperature } else { 0 }
    }
    return $MInfo
}
