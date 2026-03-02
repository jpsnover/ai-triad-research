#Requires -Version 7.0
Set-StrictMode -Version Latest
<#
.SYNOPSIS
    Loads and queries the AI Triad taxonomy JSON files.
.DESCRIPTION
    On import, reads every .json file under the taxonomy/ directory
    (sibling to scripts/) into a module-scoped hashtable keyed by POV name.
    Exposes Get-Tax to query nodes by POV, including semantic similarity search.
#>

# ─────────────────────────────────────────────────────────────────────────────
# TaxonomyNode class — typed output for Get-Tax
# ─────────────────────────────────────────────────────────────────────────────
class TaxonomyNode {
    [string]$POV
    [string]$Id
    [string]$Label
    [string]$Description
    [string]$Category
    [string]$ParentId
    [string[]]$Children
    [string[]]$CrossCuttingRefs
    [PSObject]$Interpretations
    [string[]]$LinkedNodes
    [double]$Score
}

# Register the format file for default table rendering
Update-FormatData -PrependPath (Join-Path $PSScriptRoot 'Taxonomy.Format.ps1xml')

# ─────────────────────────────────────────────────────────────────────────────
# Module-scoped store: key = POV name (lowercase), value = parsed JSON object
# ─────────────────────────────────────────────────────────────────────────────
$script:TaxonomyData = @{}

# ─────────────────────────────────────────────────────────────────────────────
# Initialization — load all taxonomy JSON files
# ─────────────────────────────────────────────────────────────────────────────
$TaxonomyDir = Join-Path $PSScriptRoot '..' 'taxonomy' 'Origin'
$TaxonomyDir = (Resolve-Path $TaxonomyDir -ErrorAction Stop).Path

foreach ($File in Get-ChildItem -Path $TaxonomyDir -Filter '*.json' -File) {
    if ($File.Name -eq 'embeddings.json') { continue }
    try {
        $Json    = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
        $PovName = $File.BaseName.ToLower()
        $script:TaxonomyData[$PovName] = $Json
        Write-Verbose "Taxonomy: loaded '$PovName' ($($Json.nodes.Count) nodes) from $($File.Name)"
    }
    catch {
        Write-Warning "Taxonomy: failed to load $($File.Name): $_"
    }
}

if ($script:TaxonomyData.Count -eq 0) {
    Write-Warning "Taxonomy: no JSON files found in $TaxonomyDir"
}

# ─────────────────────────────────────────────────────────────────────────────
# ConvertTo-TaxonomyNode — private helper (DRY: used by both code paths)
# ─────────────────────────────────────────────────────────────────────────────
function ConvertTo-TaxonomyNode {
    param(
        [string]$PovKey,
        [PSObject]$Node,
        [double]$Score = 0
    )

    $Obj = [TaxonomyNode]::new()
    $Obj.POV         = $PovKey
    $Obj.Id          = $Node.id
    $Obj.Label       = $Node.label
    $Obj.Description = $Node.description
    $Obj.Score       = $Score

    # POV files (accelerationist, safetyist, skeptic) have category/parent/children
    if ($null -ne $Node.PSObject.Properties['category']) {
        $Obj.Category         = $Node.category
        $Obj.ParentId         = $Node.parent_id
        $Obj.Children         = @($Node.children)
        $Obj.CrossCuttingRefs = @($Node.cross_cutting_refs)
    }

    # Cross-cutting file has interpretations and linked_nodes
    if ($null -ne $Node.PSObject.Properties['interpretations']) {
        $Obj.Interpretations = $Node.interpretations
        $Obj.LinkedNodes     = @($Node.linked_nodes)
    }

    $Obj
}

# ─────────────────────────────────────────────────────────────────────────────
# Get-Tax
# ─────────────────────────────────────────────────────────────────────────────
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
    #>
    [CmdletBinding(DefaultParameterSetName = 'Text')]
    param(
        [Parameter(Position = 0)]
        [string]$POV = '*',

        [Parameter(ParameterSetName = 'Text')]
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

    # ── Similar (semantic search) code path ──────────────────────────────
    if ($PSCmdlet.ParameterSetName -eq 'Similar') {
        $EmbedScript = Join-Path $PSScriptRoot 'embed_taxonomy.py'
        if (-not (Test-Path $EmbedScript)) {
            Write-Error "embed_taxonomy.py not found at $EmbedScript"
            return
        }

        $EmbeddingsFile = Join-Path $PSScriptRoot '..' 'taxonomy' 'Origin' 'embeddings.json'
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

    # ── Text filtering (default) code path ───────────────────────────────
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

            # ── node filters (Id / Label / Description — OR across all) ──
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
}

# ─────────────────────────────────────────────────────────────────────────────
# Update-TaxEmbeddings
# ─────────────────────────────────────────────────────────────────────────────
function Update-TaxEmbeddings {
    <#
    .SYNOPSIS
        Regenerates taxonomy/embeddings.json from all POV JSON files.
    .DESCRIPTION
        Calls embed_taxonomy.py generate to rebuild the semantic embeddings
        used by Get-Tax -Similar. Requires Python with sentence-transformers.
    .EXAMPLE
        Update-TaxEmbeddings
    #>
    [CmdletBinding()]
    param()

    $EmbedScript = Join-Path $PSScriptRoot 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) {
        Write-Error "embed_taxonomy.py not found at $EmbedScript"
        return
    }

    Write-Host "Generating taxonomy embeddings..." -ForegroundColor Cyan
    & python $EmbedScript generate
    if ($LASTEXITCODE -ne 0) {
        Write-Error "embed_taxonomy.py generate failed (exit code $LASTEXITCODE). Is sentence-transformers installed?"
        return
    }
    Write-Host "Embeddings updated successfully." -ForegroundColor Green
}

Export-ModuleMember -Function Get-Tax, Update-TaxEmbeddings
