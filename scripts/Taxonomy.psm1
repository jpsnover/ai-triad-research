#Requires -Version 7.0
Set-StrictMode -Version Latest
<#
.SYNOPSIS
    Loads and queries the AI Triad taxonomy JSON files.
.DESCRIPTION
    On import, reads every .json file under the taxonomy/ directory
    (sibling to scripts/) into a module-scoped hashtable keyed by POV name.
    Exposes Get-Tax to query nodes by POV.
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
$TaxonomyDir = Join-Path $PSScriptRoot '..' 'taxonomy'
$TaxonomyDir = (Resolve-Path $TaxonomyDir -ErrorAction Stop).Path

foreach ($File in Get-ChildItem -Path $TaxonomyDir -Filter '*.json' -File) {
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
# Get-Tax
# ─────────────────────────────────────────────────────────────────────────────
function Get-Tax {
    <#
    .SYNOPSIS
        Returns taxonomy nodes filtered by POV, ID, label, and/or description.
    .DESCRIPTION
        Queries the in-memory taxonomy loaded at module import time.
        -POV narrows the file scope, then any node whose ID matches
        ANY -Id pattern, OR whose label matches ANY -Label pattern,
        OR whose description matches ANY -Description pattern is returned.
    .PARAMETER POV
        Name of the POV file without the .json extension (case-insensitive).
        Supports wildcards. Default: "*" (all POVs).
    .PARAMETER Id
        One or more wildcard patterns matched against node IDs.
        A node is included if it matches ANY of the supplied patterns.
    .PARAMETER Label
        One or more wildcard patterns matched against node labels.
        A node is included if it matches ANY of the supplied patterns.
    .PARAMETER Description
        One or more wildcard patterns matched against node descriptions.
        A node is included if it matches ANY of the supplied patterns.
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
        Get-Tax -POV s* -Description "*alignment*"
        # Safetyist + skeptic nodes mentioning alignment in description.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$POV = '*',

        [string[]]$Id,

        [string[]]$Label,

        [string[]]$Description
    )

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

            $Obj = [TaxonomyNode]::new()
            $Obj.POV         = $Key
            $Obj.Id          = $Node.id
            $Obj.Label       = $Node.label
            $Obj.Description = $Node.description

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
    }
}

Export-ModuleMember -Function Get-Tax
