# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Compare-Taxonomy {
    <#
    .SYNOPSIS
        Visually compare two taxonomy directories side-by-side.
    .DESCRIPTION
        Loads taxonomy JSON files from two directories, identifies nodes with
        differing labels or descriptions, and generates an HTML report showing
        the differences.
    .PARAMETER ReferenceDir
        Path to the first (reference) taxonomy directory.
    .PARAMETER DifferenceDir
        Path to the second (difference) taxonomy directory.
    .PARAMETER PassThru
        Return the HTML file path instead of opening in the default browser.
    .EXAMPLE
        Compare-Taxonomy ./taxonomy/Origin ./taxonomy/Proposed
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$ReferenceDir,

        [Parameter(Mandatory, Position = 1)]
        [string]$DifferenceDir,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Helpers ──────────────────────────────────────────────────────────────
    function Load-TaxonomyNodes ([string]$Dir) {
        $Resolved = Resolve-Path $Dir -ErrorAction Stop
        $Nodes    = @{}
        $Files    = Get-ChildItem -Path $Resolved -Filter '*.json' -File

        foreach ($File in $Files) {
            if ($File.Name -in @('embeddings.json', 'cross-cutting.json')) { continue }
            try {
                $Json = Get-Content -Raw -Path $File.FullName | ConvertFrom-Json
                foreach ($Node in $Json.nodes) {
                    $Nodes[$Node.id] = [PSCustomObject]@{
                        Id          = $Node.id
                        Label       = $Node.label
                        Description = $Node.description
                        Category    = $Node.category
                        POV         = $Json.pov
                        SourceFile  = $File.Name
                    }
                }
            }
            catch {
                Write-Warn "Failed to load $($File.Name): $_"
            }
        }
        return $Nodes
    }

    # ── Load both sides ──────────────────────────────────────────────────────
    Write-Step 'Loading reference taxonomy'
    $RefNodes = Load-TaxonomyNodes $ReferenceDir
    Write-OK "Loaded $($RefNodes.Count) nodes from reference"

    Write-Step 'Loading difference taxonomy'
    $DiffNodes = Load-TaxonomyNodes $DifferenceDir
    Write-OK "Loaded $($DiffNodes.Count) nodes from difference"

    # ── Compute sets ─────────────────────────────────────────────────────────
    $RefIds   = [System.Collections.Generic.HashSet[string]]::new([string[]]$RefNodes.Keys)
    $DiffIds  = [System.Collections.Generic.HashSet[string]]::new([string[]]$DiffNodes.Keys)

    $CommonIds   = [System.Collections.Generic.HashSet[string]]::new($RefIds)
    [void]$CommonIds.IntersectWith($DiffIds)

    $RefOnlyIds  = [System.Collections.Generic.HashSet[string]]::new($RefIds)
    [void]$RefOnlyIds.ExceptWith($DiffIds)

    $DiffOnlyIds = [System.Collections.Generic.HashSet[string]]::new($DiffIds)
    [void]$DiffOnlyIds.ExceptWith($RefIds)

    # ── Find nodes that differ ───────────────────────────────────────────────
    $ChangedNodes = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($Id in ($CommonIds | Sort-Object)) {
        $R = $RefNodes[$Id]
        $D = $DiffNodes[$Id]
        if ($R.Label -ne $D.Label -or $R.Description -ne $D.Description) {
            $ChangedNodes.Add([PSCustomObject]@{
                Id          = $Id
                Category    = $R.Category
                RefLabel    = $R.Label
                DiffLabel   = $D.Label
                RefDesc     = $R.Description
                DiffDesc    = $D.Description
                LabelDiff   = $R.Label -ne $D.Label
                DescDiff    = $R.Description -ne $D.Description
            })
        }
    }

    Write-Step 'Comparison summary'
    Write-Info "Reference nodes:  $($RefNodes.Count)"
    Write-Info "Difference nodes: $($DiffNodes.Count)"
    Write-Info "Common nodes:     $($CommonIds.Count)"
    Write-Info "Changed nodes:    $($ChangedNodes.Count)"
    Write-Info "Only in reference:  $($RefOnlyIds.Count)"
    Write-Info "Only in difference: $($DiffOnlyIds.Count)"

    # ── Build HTML ───────────────────────────────────────────────────────────
    function Esc ([string]$Text) {
        return [System.Web.HttpUtility]::HtmlEncode($Text)
    }

    # Build changed-node cards
    $CardHtml = [System.Text.StringBuilder]::new()
    foreach ($N in $ChangedNodes) {
        $LabelClass = if ($N.LabelDiff) { 'diff' } else { 'same' }
        $DescClass  = if ($N.DescDiff)  { 'diff' } else { 'same' }

        [void]$CardHtml.AppendLine("<div class=`"card`">")
        [void]$CardHtml.AppendLine("  <div class=`"card-header`">")
        [void]$CardHtml.AppendLine("    <span class=`"node-id`">$(Esc $N.Id)</span>")
        [void]$CardHtml.AppendLine("    <span class=`"badge`">$(Esc $N.Category)</span>")
        [void]$CardHtml.AppendLine("  </div>")

        # Label row
        [void]$CardHtml.AppendLine("  <div class=`"field-group $LabelClass`">")
        [void]$CardHtml.AppendLine("    <div class=`"field-label`">Label</div>")
        [void]$CardHtml.AppendLine("    <div class=`"side ref`">$(Esc $N.RefLabel)</div>")
        [void]$CardHtml.AppendLine("    <div class=`"side diff`">$(Esc $N.DiffLabel)</div>")
        [void]$CardHtml.AppendLine("  </div>")

        # Description row
        [void]$CardHtml.AppendLine("  <div class=`"field-group $DescClass`">")
        [void]$CardHtml.AppendLine("    <div class=`"field-label`">Description</div>")
        [void]$CardHtml.AppendLine("    <div class=`"side ref`">$(Esc $N.RefDesc)</div>")
        [void]$CardHtml.AppendLine("    <div class=`"side diff`">$(Esc $N.DiffDesc)</div>")
        [void]$CardHtml.AppendLine("  </div>")

        [void]$CardHtml.AppendLine("</div>")
    }

    # Build ref-only list
    $RefOnlyHtml = [System.Text.StringBuilder]::new()
    foreach ($Id in ($RefOnlyIds | Sort-Object)) {
        $R = $RefNodes[$Id]
        [void]$RefOnlyHtml.AppendLine("<li><strong>$(Esc $Id)</strong> &mdash; $(Esc $R.Label)</li>")
    }

    # Build diff-only list
    $DiffOnlyHtml = [System.Text.StringBuilder]::new()
    foreach ($Id in ($DiffOnlyIds | Sort-Object)) {
        $D = $DiffNodes[$Id]
        [void]$DiffOnlyHtml.AppendLine("<li><strong>$(Esc $Id)</strong> &mdash; $(Esc $D.Label)</li>")
    }

    $Generated = Get-Date -Format 'yyyy-MM-dd HH:mm'

    $Html = @'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Taxonomy Comparison</title>
<style>
  :root {
    --bg: #1e1e2e;
    --surface: #282840;
    --surface2: #313150;
    --text: #e0e0e8;
    --muted: #8888aa;
    --accent: #7c8ff0;
    --ref-bg: #2a1e1e;
    --ref-border: #cc6666;
    --diff-bg: #1e2a1e;
    --diff-border: #66cc66;
    --badge-bg: #3a3a5c;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 2rem;
    line-height: 1.5;
  }
  h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 1.6rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .stat {
    background: var(--surface);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }
  .stat .value { font-size: 2rem; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; }
  h2 { color: var(--accent); margin: 2rem 0 1rem; font-size: 1.2rem; }
  .legend {
    display: flex; gap: 1.5rem; margin-bottom: 1.5rem; font-size: 0.85rem;
  }
  .legend-item { display: flex; align-items: center; gap: 0.4rem; }
  .legend-swatch {
    width: 14px; height: 14px; border-radius: 3px; border: 2px solid;
  }
  .legend-swatch.ref  { background: var(--ref-bg); border-color: var(--ref-border); }
  .legend-swatch.diff { background: var(--diff-bg); border-color: var(--diff-border); }
  .card {
    background: var(--surface);
    border-radius: 8px;
    margin-bottom: 1.25rem;
    overflow: hidden;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--surface2);
  }
  .node-id { font-weight: 600; font-family: monospace; font-size: 0.95rem; }
  .badge {
    background: var(--badge-bg);
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .field-group { padding: 0.75rem 1rem; }
  .field-group.same { opacity: 0.5; }
  .field-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.4rem;
    font-weight: 600;
    letter-spacing: 0.05em;
  }
  .side {
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.35rem;
    border-left: 3px solid;
    font-size: 0.9rem;
  }
  .side.ref  { background: var(--ref-bg); border-color: var(--ref-border); }
  .side.diff { background: var(--diff-bg); border-color: var(--diff-border); }
  .only-list {
    background: var(--surface);
    border-radius: 8px;
    padding: 1rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  .only-list ul { list-style: none; }
  .only-list li {
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--surface2);
    font-size: 0.9rem;
  }
  .only-list li:last-child { border-bottom: none; }
  .empty { color: var(--muted); font-style: italic; }
</style>
</head>
<body>
<h1>Taxonomy Comparison</h1>
<p class="meta">
  <strong>Reference:</strong> {{REF_DIR}} &nbsp;&bull;&nbsp;
  <strong>Difference:</strong> {{DIFF_DIR}} &nbsp;&bull;&nbsp;
  Generated {{GENERATED}}
</p>

<div class="summary">
  <div class="stat"><div class="value">{{REF_COUNT}}</div><div class="label">Reference Nodes</div></div>
  <div class="stat"><div class="value">{{DIFF_COUNT}}</div><div class="label">Difference Nodes</div></div>
  <div class="stat"><div class="value">{{COMMON_COUNT}}</div><div class="label">Common Nodes</div></div>
  <div class="stat"><div class="value">{{CHANGED_COUNT}}</div><div class="label">Changed Nodes</div></div>
  <div class="stat"><div class="value">{{REF_ONLY_COUNT}}</div><div class="label">Only in Reference</div></div>
  <div class="stat"><div class="value">{{DIFF_ONLY_COUNT}}</div><div class="label">Only in Difference</div></div>
</div>

{{CHANGED_SECTION}}

{{REF_ONLY_SECTION}}

{{DIFF_ONLY_SECTION}}

</body>
</html>
'@

    # Build changed section
    if ($ChangedNodes.Count -gt 0) {
        $ChangedSection = @"
<h2>Changed Nodes ($($ChangedNodes.Count))</h2>
<div class="legend">
  <div class="legend-item"><div class="legend-swatch ref"></div> Reference</div>
  <div class="legend-item"><div class="legend-swatch diff"></div> Difference</div>
</div>
$($CardHtml.ToString())
"@
    }
    else {
        $ChangedSection = '<h2>Changed Nodes</h2><p class="empty">No differences found.</p>'
    }

    # Build ref-only section
    if ($RefOnlyIds.Count -gt 0) {
        $RefOnlySection = @"
<h2>Only in Reference ($($RefOnlyIds.Count))</h2>
<div class="only-list"><ul>
$($RefOnlyHtml.ToString())
</ul></div>
"@
    }
    else {
        $RefOnlySection = ''
    }

    # Build diff-only section
    if ($DiffOnlyIds.Count -gt 0) {
        $DiffOnlySection = @"
<h2>Only in Difference ($($DiffOnlyIds.Count))</h2>
<div class="only-list"><ul>
$($DiffOnlyHtml.ToString())
</ul></div>
"@
    }
    else {
        $DiffOnlySection = ''
    }

    # Token replacement
    $Html = $Html -replace '{{REF_DIR}}',        (Esc $ReferenceDir)
    $Html = $Html -replace '{{DIFF_DIR}}',       (Esc $DifferenceDir)
    $Html = $Html -replace '{{GENERATED}}',      $Generated
    $Html = $Html -replace '{{REF_COUNT}}',       $RefNodes.Count
    $Html = $Html -replace '{{DIFF_COUNT}}',      $DiffNodes.Count
    $Html = $Html -replace '{{COMMON_COUNT}}',    $CommonIds.Count
    $Html = $Html -replace '{{CHANGED_COUNT}}',   $ChangedNodes.Count
    $Html = $Html -replace '{{REF_ONLY_COUNT}}',  $RefOnlyIds.Count
    $Html = $Html -replace '{{DIFF_ONLY_COUNT}}', $DiffOnlyIds.Count
    $Html = $Html -replace '{{CHANGED_SECTION}}', $ChangedSection
    $Html = $Html -replace '{{REF_ONLY_SECTION}}',  $RefOnlySection
    $Html = $Html -replace '{{DIFF_ONLY_SECTION}}', $DiffOnlySection

    # ── Write and open ───────────────────────────────────────────────────────
    $TempPath = Join-Path ([System.IO.Path]::GetTempPath()) 'AITriad-TaxonomyCompare.html'
    Set-Content -Path $TempPath -Value $Html -Encoding utf8
    Write-OK "Report written to $TempPath"

    if ($PassThru) { return $TempPath }

    if ($IsWindows)   { Start-Process $TempPath }
    elseif ($IsMacOS) { Start-Process 'open' -ArgumentList $TempPath }
    elseif ($IsLinux) { Start-Process 'xdg-open' -ArgumentList $TempPath }
}
