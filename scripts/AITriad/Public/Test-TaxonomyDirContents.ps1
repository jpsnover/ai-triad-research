# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-TaxonomyDirContents {
    <#
    .SYNOPSIS
        Validates the JSON files in TAXONOMY_DIR before an Update-TaxEmbeddings run.
    .DESCRIPTION
        Update-TaxEmbeddings (embed_taxonomy.py) iterates every *.json file in the
        taxonomy directory that is not in its SKIP_FILES set, treating each file's
        `nodes` field as a list of node objects. A file whose `nodes` is a dict —
        e.g. an embedding-index artifact like embeddings-orgstance-6733.json — makes
        the script iterate string keys and crash with
        "'str' object has no attribute 'get'" (see t/1652).

        This cmdlet mirrors embed_taxonomy.py's skip logic (SKIP_FILES plus the
        `embeddings-` filename prefix) and inspects the `nodes` field of every file
        the script would actually load, flagging any that would yield non-object
        node values. Run it before Update-TaxEmbeddings, especially after new files
        land in TAXONOMY_DIR or after a data-repo pull.

        Output is one record per file with File, NodesType, Skipped, and Safe. A
        file is Unsafe only if the embedding script would load it AND its `nodes`
        would not iterate as a list of objects. Use -Detailed for NodeCount, Reason,
        and full path.
    .PARAMETER TaxonomyDir
        Taxonomy directory to inspect. Defaults to the resolved taxonomy dir from
        .aitriad.json (Get-TaxonomyDir).
    .PARAMETER Detailed
        Emit the full per-file breakdown (NodeCount, Reason, Path) in addition to
        the summary columns.
    .EXAMPLE
        Test-TaxonomyDirContents
        Lists every taxonomy JSON file and whether it is safe to embed.
    .EXAMPLE
        Test-TaxonomyDirContents -Detailed | Where-Object { -not $_.Safe }
        Shows only the files that would crash Update-TaxEmbeddings, with reasons.
    .OUTPUTS
        [PSCustomObject] with File, NodesType, Skipped, Safe (and, with -Detailed,
        NodeCount, Reason, Path).
    .LINK
        Update-TaxEmbeddings
    .LINK
        Get-Tax
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter()]
        [string]$TaxonomyDir,

        [Parameter()]
        [switch]$Detailed
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if ([string]::IsNullOrWhiteSpace($TaxonomyDir)) {
        $TaxonomyDir = Get-TaxonomyDir
    }

    if (-not (Test-Path -LiteralPath $TaxonomyDir -PathType Container)) {
        New-ActionableError `
            -Goal 'Validate taxonomy directory contents before embedding' `
            -Problem "Taxonomy directory not found: $TaxonomyDir" `
            -Location 'Test-TaxonomyDirContents' `
            -NextSteps @(
                'Verify .aitriad.json points at the correct data root',
                'Pass an explicit -TaxonomyDir path',
                'Confirm the ai-triad-data repo is checked out') `
            -Throw
        return
    }

    # Mirror of embed_taxonomy.py SKIP_FILES (scripts/embed_taxonomy.py:135). Keep
    # in sync — a file the script skips is not a crash risk, so we skip it too.
    $SkipFiles = @(
        'embeddings.json'
        'edges.json'
        'policy_actions.json'
        'lineage_categories.json'
        '_archived_edges.json'
        'interpretation_embeddings.json'
    )

    # Column set: compact by default, full breakdown with -Detailed.
    if ($Detailed) {
        $props = @('File', 'NodesType', 'Skipped', 'Safe', 'NodeCount', 'Reason', 'Path')
    }
    else {
        $props = @('File', 'NodesType', 'Skipped', 'Safe')
    }

    foreach ($File in (Get-ChildItem -LiteralPath $TaxonomyDir -Filter '*.json' -File | Sort-Object Name)) {
        # embed_taxonomy.py skips SKIP_FILES and any `embeddings-*` filename
        # (the embedding-index artifacts, t/1652). Skipped files never reach the
        # node-iteration path, so they are safe regardless of shape.
        $isSkipped = ($File.Name -in $SkipFiles) -or
                     ([System.IO.Path]::GetFileNameWithoutExtension($File.Name).StartsWith('embeddings-'))

        if ($isSkipped) {
            if ($File.Name -in $SkipFiles) { $reason = 'In SKIP_FILES; not loaded' }
            else { $reason = 'Matches embeddings- prefix; not loaded' }
            [PSCustomObject]@{
                File      = $File.Name
                NodesType = '(skipped)'
                Skipped   = $true
                Safe      = $true
                NodeCount = $null
                Reason    = $reason
                Path      = $File.FullName
            } | Select-Object $props
            continue
        }

        # Parse and classify the `nodes` field the way embed_taxonomy.py would.
        $nodesType = $null
        $nodeCount = $null
        $safe = $true
        $reason = ''

        try {
            $data = Get-Content -Raw -LiteralPath $File.FullName -Encoding utf8 | ConvertFrom-Json
        }
        catch {
            # embed_taxonomy.py catches JSONDecodeError/OSError and skips the file
            # with a warning — a parse error does not crash the run.
            [PSCustomObject]@{
                File      = $File.Name
                NodesType = '(parse error)'
                Skipped   = $false
                Safe      = $true
                NodeCount = $null
                Reason    = "JSON parse error; script will skip: $($_.Exception.Message)"
                Path      = $File.FullName
            } | Select-Object $props
            continue
        }

        if (-not $data.PSObject.Properties['nodes']) {
            # Missing key → embed_taxonomy uses data.get("nodes", []) → empty, safe.
            $nodesType = '(no nodes key)'
            $safe = $true
            $reason = 'No `nodes` key; script iterates an empty list'
        }
        else {
            $nodes = $data.nodes
            if ($null -eq $nodes) {
                # nodes:null → data.get returns None → `for node in None` crashes.
                $nodesType = 'null'
                $safe = $false
                $reason = '`nodes` is null; script would fail to iterate it'
            }
            elseif ($nodes -is [System.Management.Automation.PSCustomObject]) {
                # A JSON object (dict) — iterating yields string keys → crash.
                $nodesType = 'dict'
                $safe = $false
                $reason = '`nodes` is a dict (embedding index?); iterating yields keys, not node objects'
            }
            elseif ($nodes -is [System.Collections.IEnumerable] -and $nodes -isnot [string]) {
                $elems = @($nodes)
                $nodeCount = $elems.Count
                $nonObjects = @($elems | Where-Object { $_ -isnot [System.Management.Automation.PSCustomObject] })
                if ($elems.Count -eq 0) {
                    $nodesType = 'list (empty)'
                    $safe = $true
                    $reason = 'Empty node list; nothing to embed'
                }
                elseif ($nonObjects.Count -gt 0) {
                    $elemType = $nonObjects[0].GetType().Name
                    $nodesType = "list of $elemType"
                    $safe = $false
                    $reason = "$($nonObjects.Count)/$($elems.Count) elements are not objects (e.g. $elemType); node access would crash"
                }
                else {
                    $nodesType = 'list'
                    $safe = $true
                    $reason = "$($elems.Count) node objects"
                }
            }
            else {
                # Scalar (string/number/bool) — not iterable as node list.
                $nodesType = $nodes.GetType().Name
                $safe = $false
                $reason = "`nodes` is a scalar ($nodesType); not a list of node objects"
            }
        }

        if (-not $safe) {
            Write-Warning "Unsafe for Update-TaxEmbeddings: $($File.Name) — $reason"
        }

        [PSCustomObject]@{
            File      = $File.Name
            NodesType = $nodesType
            Skipped   = $false
            Safe      = $safe
            NodeCount = $nodeCount
            Reason    = $reason
            Path      = $File.FullName
        } | Select-Object $props
    }
}
