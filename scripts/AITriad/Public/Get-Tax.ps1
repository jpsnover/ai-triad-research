# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-Tax {
    <#
    .SYNOPSIS
        Returns taxonomy nodes filtered by POV, ID, label, description, or
        semantic similarity.
    .DESCRIPTION
        Queries the in-memory taxonomy loaded at module import time.

        Text filtering (default):
        -POV narrows the file scope, then any node whose ID matches
        ANY -Id pattern, OR whose label matches ANY -Label pattern,
        OR whose description matches ANY -Description pattern is returned.

        Semantic search (-Similar):
        Calls the Python embedding script to rank all nodes by cosine
        similarity to the query text. Returns results sorted by score.
        Requires embeddings.json (run Update-TaxEmbeddings first).
    .PARAMETER POV
        Name of the POV file without the .json extension (case-insensitive).
        Supports wildcards. Default: "*" (all POVs).
    .PARAMETER Id
        One or more wildcard patterns matched against node IDs.
    .PARAMETER Label
        One or more wildcard patterns matched against node labels.
    .PARAMETER Description
        One or more wildcard patterns matched against node descriptions.
    .PARAMETER Similar
        A text query for semantic similarity search. Mutually exclusive
        with -Id, -Label, and -Description.
    .PARAMETER Top
        Maximum number of results to return (only with -Similar).
        Default: 20.
    .EXAMPLE
        Get-Tax
        # Returns all nodes from every loaded POV.
    .EXAMPLE
        Get-Tax -POV skeptic
        # Returns only skeptic nodes.
    .EXAMPLE
        Get-Tax -Label "*bias*","*displacement*"
        # Returns nodes whose label matches either pattern.
    .EXAMPLE
        Get-Tax -Similar "alignment safety"
        # Ranked semantic search across all POVs.
    .EXAMPLE
        Get-Tax -POV safetyist -Similar "labor displacement"
        # Semantic search scoped to safetyist POV.
    .EXAMPLE
        Get-Tax -Similar "governance" -Top 5
        # Top 5 semantically similar nodes.
    .EXAMPLE
        'acc-goals-001','saf-goals-001' | Get-Tax
        # Pipeline by value — accepts bare ID strings.
    .EXAMPLE
        Get-Tax -Id 'acc-goals-*' | Get-Tax
        # Pipeline by property name — objects with an Id property.
    #>
    [CmdletBinding(DefaultParameterSetName = 'Text')]
    param(
        [Parameter(Position = 0)]
        [string]$POV = '*',

        [Parameter(ParameterSetName = 'Text', ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [string[]]$Id,

        [Parameter(ParameterSetName = 'Text')]
        [string[]]$Label,

        [Parameter(ParameterSetName = 'Text')]
        [string[]]$Description,

        [Parameter(Mandatory, ParameterSetName = 'Similar')]
        [string]$Similar,

        [Parameter(ParameterSetName = 'Similar')]
        [ValidateRange(1, 1000)]
        [int]$Top = 20
    )

    begin {
        Set-StrictMode -Version Latest
        $CollectedIds = [System.Collections.Generic.List[string]]::new()
    }

    process {
        # Accumulate pipeline-bound -Id values
        if ($Id) {
            foreach ($i in $Id) {
                if (-not [string]::IsNullOrWhiteSpace($i)) {
                    $CollectedIds.Add($i)
                }
            }
        }
    }

    end {

    # Merge collected pipeline IDs with any directly specified
    if ($CollectedIds.Count -gt 0) {
        $Id = @($CollectedIds | Select-Object -Unique)
    }

    # -- Similar (semantic search) code path ----------------------------------
    if ($PSCmdlet.ParameterSetName -eq 'Similar') {
        $EmbedScript = Join-Path $script:ModuleRoot '..' 'embed_taxonomy.py'
        if (-not (Test-Path $EmbedScript)) {
            Write-Error "embed_taxonomy.py not found at $EmbedScript"
            return
        }

        $EmbeddingsFile = Join-Path $script:RepoRoot 'taxonomy' 'Origin' 'embeddings.json'
        if (-not (Test-Path $EmbeddingsFile)) {
            Write-Error "embeddings.json not found. Run Update-TaxEmbeddings first."
            return
        }

        # Build Python arguments
        $PyArgs = @('query', $Similar, '--top', $Top)
        if ($POV -ne '*') {
            $PyArgs += @('--pov', $POV)
        }

        $PyResult = & python $EmbedScript @PyArgs 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "embed_taxonomy.py query failed (exit code $LASTEXITCODE). Is sentence-transformers installed?"
            return
        }

        $Results = $PyResult | ConvertFrom-Json

        if (-not $Results -or $Results.Count -eq 0) {
            Write-Warning "No similar nodes found."
            return
        }

        # Build a lookup from in-memory taxonomy for full node data
        $NodeLookup = @{}
        foreach ($Key in $script:TaxonomyData.Keys) {
            $Entry = $script:TaxonomyData[$Key]
            foreach ($Node in $Entry.nodes) {
                $NodeLookup[$Node.id] = @{ POV = $Key; Node = $Node }
            }
        }

        foreach ($Hit in $Results) {
            $Info = $NodeLookup[$Hit.id]
            if (-not $Info) { continue }

            $Obj = ConvertTo-TaxonomyNode -PovKey $Info.POV -Node $Info.Node -Score $Hit.score
            $Obj.PSObject.TypeNames.Insert(0, 'TaxonomyNode.Similar')
            $Obj
        }
        return
    }

    # -- Text filtering (default) code path -----------------------------------
    $MatchingKeys = $script:TaxonomyData.Keys | Where-Object { $_ -like $POV.ToLower() }

    if (-not $MatchingKeys) {
        $Available = ($script:TaxonomyData.Keys | Sort-Object) -join ', '
        Write-Warning "No POV matching '$POV'. Available: $Available"
        return
    }

    $HasId     = ($null -ne $Id) -and ($Id.Length -gt 0)
    $HasLabel  = ($null -ne $Label) -and ($Label.Length -gt 0)
    $HasDesc   = ($null -ne $Description) -and ($Description.Length -gt 0)
    $HasTextFilter = $HasId -or $HasLabel -or $HasDesc

    foreach ($Key in $MatchingKeys | Sort-Object) {
        $Entry = $script:TaxonomyData[$Key]
        foreach ($Node in $Entry.nodes) {

            if ($HasTextFilter) {
                $Match = $false
                foreach ($Pat in $Id) {
                    if ($Node.id -like $Pat) { $Match = $true; break }
                }
                if (-not $Match) {
                    foreach ($Pat in $Label) {
                        if ($Node.label -like $Pat) { $Match = $true; break }
                    }
                }
                if (-not $Match) {
                    foreach ($Pat in $Description) {
                        if ($Node.description -like $Pat) { $Match = $true; break }
                    }
                }
                if (-not $Match) { continue }
            }

            ConvertTo-TaxonomyNode -PovKey $Key -Node $Node
        }
    }

    } # end
}
