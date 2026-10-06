# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AITSBOMAIModels {
    <#
    .SYNOPSIS
        SBOM entries for AI models listed in ai-models.json. Extracted
        verbatim from Get-AITSBOM (t/3910) -- no behavior change.
    .PARAMETER RepoRoot
        Repository root path.
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param(
        [Parameter(Mandatory)]
        [string]$RepoRoot
    )

    Set-StrictMode -Version Latest
    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    $ModelsPath = Join-Path $RepoRoot 'ai-models.json'
    if (Test-Path $ModelsPath) {
        try {
            $ModelConfig = Get-Content -Raw -Path $ModelsPath | ConvertFrom-Json
            foreach ($Model in $ModelConfig.models) {
                $ModelUrl = $null
                if ($Model.PSObject.Properties['backend']) {
                    $ModelUrl = switch ($Model.backend) {
                        'gemini'    { "https://ai.google.dev/models/$($Model.id)" }
                        'anthropic' { "https://docs.anthropic.com/en/docs/about-claude/models" }
                        'groq'      { "https://console.groq.com/docs/models" }
                        'openai'    { "https://platform.openai.com/docs/models/$($Model.id)" }
                        default     { $null }
                    }
                }
                $ModelSupplier = if ($Model.PSObject.Properties['backend']) { $Model.backend } else { $null }
                $Entries.Add([PSCustomObject]@{
                    Name          = $Model.id
                    Version       = if ($Model.PSObject.Properties['version']) { $Model.version } else { 'latest' }
                    LatestVersion = $null
                    Status        = $null
                    Type          = 'ai-model'
                    Scope         = 'required'
                    Source        = 'ai-models.json'
                    SourceUrl     = $ModelUrl
                    License       = if ($Model.PSObject.Properties['license']) { $Model.license } else { $null }
                    Supplier      = $ModelSupplier
                    Description   = if ($Model.PSObject.Properties['display_name']) { $Model.display_name } else { $null }
                    Hash          = $null
                    InstalledVia  = 'API'
                })
            }
        }
        catch {
            Write-Warning "Failed to parse ai-models.json: $($_.Exception.Message)"
        }
    }

    # Comma-wrap: a bare `return $Entries` would flatten the List[PSObject] into a plain
    # array at the function-return boundary (losing .AddRange()) -- the t/3948-class
    # unroll hazard, here for a whole collection rather than a single element.
    return ,$Entries
}
