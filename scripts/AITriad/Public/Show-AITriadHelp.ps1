# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Show-AITriadHelp {
    <#
    .SYNOPSIS
        Generates a self-contained HTML reference page for the AITriad module
        and opens it in the default browser.
    .DESCRIPTION
        Builds a single-page HTML help document covering every public function,
        alias, supported AI model, environment variable, and CI workflow in the
        AITriad module. The page uses inline CSS with no external dependencies.

        The file is written to the system temp directory with a fixed name so
        repeated calls overwrite instead of accumulating temp files.
    .PARAMETER PassThru
        Return the generated file path instead of opening the browser.
    .EXAMPLE
        Show-AITriadHelp
        # Opens the help page in the default browser.
    .EXAMPLE
        Show-AITriadHelp -PassThru
        # Returns the temp file path without opening a browser.
    #>
    [CmdletBinding()]
    param(
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest

    # Read module version from manifest
    $ManifestPath = Join-Path $PSScriptRoot '..' 'AITriad.psd1'
    $ManifestData = Import-PowerShellDataFile -Path $ManifestPath
    $Version      = $ManifestData.ModuleVersion
    $Generated    = Get-Date -Format 'yyyy-MM-dd HH:mm'

    # Build HTML using single-quoted here-string (no $ escaping needed)
    $Html = @'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AITriad Module Reference</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #1a1a2e;
    background: #f0f2f5;
    margin: 0;
    padding: 2rem 1rem;
  }
  .container { max-width: 900px; margin: 0 auto; }

  /* Header banner */
  .banner {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #fff;
    padding: 2.5rem 2rem;
    border-radius: 12px;
    margin-bottom: 2rem;
    text-align: center;
  }
  .banner h1 { margin: 0 0 0.25rem; font-size: 2rem; font-weight: 700; }
  .banner .meta { opacity: 0.8; font-size: 0.9rem; }

  /* Hero image */
  .hero-img {
    display: block;
    max-width: 100%;
    border-radius: 10px;
    margin-bottom: 2rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }

  /* Navigation */
  .toc {
    background: #fff;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .toc h2 { margin: 0 0 0.75rem; font-size: 1.1rem; color: #0f3460; }
  .toc ul { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 2rem; }
  .toc li { margin-bottom: 0.3rem; }
  .toc a { color: #0f3460; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }

  /* Section cards */
  .card {
    background: #fff;
    border-radius: 10px;
    padding: 1.5rem 2rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    border-left: 4px solid #0f3460;
  }
  .card h2 {
    margin: 0 0 1rem;
    font-size: 1.3rem;
    color: #0f3460;
  }
  .card h3 {
    margin: 1.25rem 0 0.5rem;
    font-size: 1.05rem;
    color: #16213e;
  }
  .card p { margin: 0.5rem 0; }

  /* Category colors */
  .card.cat-query    { border-left-color: #2196f3; }
  .card.cat-query h2 { color: #1565c0; }
  .card.cat-ingest    { border-left-color: #4caf50; }
  .card.cat-ingest h2 { color: #2e7d32; }
  .card.cat-summary    { border-left-color: #ff9800; }
  .card.cat-summary h2 { color: #e65100; }
  .card.cat-analysis    { border-left-color: #e91e63; }
  .card.cat-analysis h2 { color: #ad1457; }
  .card.cat-util    { border-left-color: #9c27b0; }
  .card.cat-util h2 { color: #6a1b9a; }
  .card.cat-app    { border-left-color: #00bcd4; }
  .card.cat-app h2 { color: #00838f; }
  .card.cat-help   { border-left-color: #607d8b; }
  .card.cat-help h2 { color: #37474f; }

  /* Function cards */
  .func {
    background: #fafbfc;
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .func h4 {
    margin: 0 0 0.5rem;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 1rem;
    color: #0f3460;
  }
  .func .synopsis { font-style: italic; color: #555; margin-bottom: 0.75rem; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    font-size: 0.9rem;
  }
  th, td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #e1e4e8;
  }
  th {
    background: #f0f2f5;
    font-weight: 600;
    color: #16213e;
  }
  tr:nth-child(even) td { background: #fafbfc; }

  /* Code blocks */
  pre {
    background: #1a1a2e;
    color: #e0e0e0;
    padding: 1rem 1.25rem;
    border-radius: 6px;
    overflow-x: auto;
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  code {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 0.88em;
  }
  p code, li code, td code {
    background: #eef1f5;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    color: #0f3460;
  }

  /* Footer */
  .footer {
    text-align: center;
    color: #888;
    font-size: 0.8rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid #ddd;
  }
</style>
</head>
<body>
<div class="container">

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- BANNER                                                                -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="banner">
  <h1>AITriad Module Reference</h1>
  <div class="meta">Version {{VERSION}} &middot; Generated {{GENERATED}}</div>
</div>

<!-- Hero image (copied to temp dir by PowerShell) -->
<img class="hero-img" src="AITriad-Module.png" alt="AITriad Module Reference Infographic">

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- TABLE OF CONTENTS                                                     -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="toc">
  <h2>Contents</h2>
  <ul>
    <li><a href="#overview">Module Overview</a></li>
    <li><a href="#quickstart">Quick Start</a></li>
    <li><a href="#taxonomy">Taxonomy &amp; Query</a></li>
    <li><a href="#ingestion">Document Ingestion</a></li>
    <li><a href="#summarization">Summarization</a></li>
    <li><a href="#analysis">Analysis</a></li>
    <li><a href="#utilities">Utilities</a></li>
    <li><a href="#launchers">App Launchers</a></li>
    <li><a href="#help">Help</a></li>
    <li><a href="#aliases">Aliases</a></li>
    <li><a href="#models">Supported AI Models</a></li>
    <li><a href="#cicd">CI/CD Workflow</a></li>
    <li><a href="#envvars">Environment Variables</a></li>
  </ul>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- MODULE OVERVIEW                                                       -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card" id="overview">
  <h2>Module Overview</h2>
  <p>
    <strong>AITriad</strong> is a PowerShell 7+ research module for multi-perspective
    analysis of AI policy and safety literature. It organizes sources through a
    four-POV taxonomy (accelerationist, safetyist, skeptic, cross-cutting),
    ingests documents, generates AI-powered summaries, and detects factual conflicts.
  </p>
  <h3>Companion Modules</h3>
  <table>
    <tr><th>Module</th><th>Purpose</th></tr>
    <tr><td><code>AIEnrich</code></td><td>Multi-backend AI API abstraction (Gemini, Claude, Groq)</td></tr>
    <tr><td><code>DocConverters</code></td><td>PDF, DOCX, and HTML to Markdown conversion</td></tr>
    <tr><td><code>PdfOptimizer</code></td><td>PDF compression and optimization utilities</td></tr>
  </table>
  <h3>Taxonomy Structure</h3>
  <p>Four points of view, each stored as a JSON file under <code>taxonomy/Origin/</code>.
  Each node may have a <code>graph_attributes</code> object with AI-generated analytical
  metadata (epistemic type, rhetorical strategy, assumptions, falsifiability, audience,
  emotional register, policy actionability, intellectual lineage, and steelman vulnerability).
  See <code>Invoke-AttributeExtraction</code>.</p>
  <table>
    <tr><th>POV</th><th>Prefix</th><th>Description</th></tr>
    <tr><td>Accelerationist</td><td><code>acc-</code></td><td>Pro-development, rapid AI progress</td></tr>
    <tr><td>Safetyist</td><td><code>saf-</code></td><td>AI safety and alignment focus</td></tr>
    <tr><td>Skeptic</td><td><code>skp-</code></td><td>Questioning AI hype and capabilities</td></tr>
    <tr><td>Cross-cutting</td><td><code>cc-</code></td><td>Issues spanning multiple POVs</td></tr>
  </table>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- QUICK START                                                           -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card" id="quickstart">
  <h2>Quick Start</h2>
<pre>
# Import the module
Import-Module ./scripts/AITriad -Force

# Browse all taxonomy nodes
Get-Tax

# Ingest a web article
Import-AITriadDocument -Url 'https://example.com/article' -Pov accelerationist

# Run batch summarization
Invoke-BatchSummary -DryRun

# Open the help page you are reading now
Show-AITriadHelp
</pre>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- TAXONOMY & QUERY                                                      -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-query" id="taxonomy">
  <h2>Taxonomy &amp; Query</h2>

  <div class="func">
    <h4>Get-Tax</h4>
    <div class="synopsis">Returns taxonomy nodes filtered by POV, ID, label, description, or semantic similarity.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-POV</code></td><td>string</td><td>No</td><td>POV name (supports wildcards). Default: <code>*</code></td></tr>
      <tr><td><code>-Id</code></td><td>string[]</td><td>No</td><td>Wildcard patterns matched against node IDs</td></tr>
      <tr><td><code>-Label</code></td><td>string[]</td><td>No</td><td>Wildcard patterns matched against node labels</td></tr>
      <tr><td><code>-Description</code></td><td>string[]</td><td>No</td><td>Wildcard patterns matched against node descriptions</td></tr>
      <tr><td><code>-Similar</code></td><td>string</td><td>Yes*</td><td>Semantic similarity query (mutually exclusive with text filters)</td></tr>
      <tr><td><code>-Top</code></td><td>int</td><td>No</td><td>Max results for <code>-Similar</code>. Default: 20</td></tr>
    </table>
<pre>
Get-Tax -POV skeptic
Get-Tax -Label "*bias*","*displacement*"
Get-Tax -Similar "alignment safety" -Top 5
</pre>
  </div>

  <div class="func">
    <h4>Update-TaxEmbeddings</h4>
    <div class="synopsis">Regenerates taxonomy/Origin/embeddings.json from all POV JSON files for semantic search.</div>
    <p>No parameters. Requires Python with <code>sentence-transformers</code> installed.
    Uses the local <code>all-MiniLM-L6-v2</code> model (384-dimensional vectors).
    Each node's <strong>description</strong> field is embedded.</p>
<pre>
Update-TaxEmbeddings
</pre>
  </div>

  <div class="func">
    <h4>Get-Source</h4>
    <div class="synopsis">Lists and filters source documents in the repository.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-DocId</code></td><td>string</td><td>No</td><td>Wildcard pattern matched against the source document ID</td></tr>
      <tr><td><code>-Pov</code></td><td>string</td><td>No</td><td>Filter to sources whose pov_tags contain this value</td></tr>
      <tr><td><code>-Topic</code></td><td>string</td><td>No</td><td>Filter to sources whose topic_tags contain this value</td></tr>
      <tr><td><code>-Status</code></td><td>string</td><td>No</td><td>Filter to sources with this summary_status</td></tr>
      <tr><td><code>-SourceType</code></td><td>string</td><td>No</td><td>Filter to sources with this source_type</td></tr>
    </table>
<pre>
Get-Source
Get-Source '*china*'
Get-Source -Pov safetyist
Get-Source -Status pending
</pre>
  </div>

  <div class="func">
    <h4>Get-Summary</h4>
    <div class="synopsis">Lists and filters POV summaries in the repository.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-DocId</code></td><td>string</td><td>No</td><td>Wildcard pattern matched against the summary doc_id</td></tr>
      <tr><td><code>-Pov</code></td><td>string</td><td>No</td><td>Only include key_points from this POV</td></tr>
      <tr><td><code>-Stance</code></td><td>string</td><td>No</td><td>Only include key_points with this stance value</td></tr>
      <tr><td><code>-Detailed</code></td><td>switch</td><td>No</td><td>Include the KeyPoints array in output</td></tr>
    </table>
<pre>
Get-Summary
Get-Summary '*safety*'
Get-Summary -Pov skeptic -Detailed
Get-Summary -Pov accelerationist -Stance opposed -Detailed
</pre>
  </div>

  <div class="func">
    <h4>ConvertTo-GeneralTaxonomy</h4>
    <div class="synopsis">Creates plain-English taxonomy files for a general audience using AI rewriting.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-Model</code></td><td>string</td><td>No</td><td>AI model to use. Default: <code>gemini-3.1-flash-lite-preview</code></td></tr>
      <tr><td><code>-Temperature</code></td><td>double</td><td>No</td><td>Sampling temperature (0.0&ndash;1.0). Default: 0.3</td></tr>
      <tr><td><code>-ApiKey</code></td><td>string</td><td>No</td><td>Explicit API key override</td></tr>
      <tr><td><code>-DryRun</code></td><td>switch</td><td>No</td><td>Show plan without making API calls</td></tr>
    </table>
<pre>
ConvertTo-GeneralTaxonomy -DryRun
ConvertTo-GeneralTaxonomy -Model claude-sonnet-4-5 -Temperature 0.4
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- DOCUMENT INGESTION                                                    -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-ingest" id="ingestion">
  <h2>Document Ingestion</h2>

  <div class="func">
    <h4>Import-AITriadDocument</h4>
    <div class="synopsis">Ingests web articles, PDFs, and local files into the AI Triad research corpus.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-Url</code></td><td>string</td><td>Yes*</td><td>URL of web article to ingest (ByUrl set)</td></tr>
      <tr><td><code>-File</code></td><td>string</td><td>Yes*</td><td>Path to local PDF/DOCX/HTML file (ByFile set)</td></tr>
      <tr><td><code>-Inbox</code></td><td>switch</td><td>Yes*</td><td>Process all files in <code>sources/_inbox/</code> (ByInbox set)</td></tr>
      <tr><td><code>-Pov</code></td><td>string[]</td><td>No</td><td>POV tags to assign</td></tr>
      <tr><td><code>-Topic</code></td><td>string[]</td><td>No</td><td>Topic tags to assign</td></tr>
      <tr><td><code>-SkipWayback</code></td><td>switch</td><td>No</td><td>Skip Wayback Machine archival</td></tr>
      <tr><td><code>-NoSummaryQueue</code></td><td>switch</td><td>No</td><td>Do not mark for AI summarization</td></tr>
      <tr><td><code>-SkipAiMeta</code></td><td>switch</td><td>No</td><td>Skip AI metadata-enrichment step</td></tr>
      <tr><td><code>-Model</code></td><td>string</td><td>No</td><td>AI model for enrichment and summarization. Default: <code>gemini-3.1-flash-lite-preview</code></td></tr>
      <tr><td><code>-Temperature</code></td><td>double</td><td>No</td><td>Sampling temperature (0.0&ndash;1.0). Default: 0.1</td></tr>
    </table>
<pre>
Import-AITriadDocument -Url 'https://example.com/article' -Pov accelerationist, skeptic
Import-AITriadDocument -Inbox
Import-AITriadDocument -File './paper.pdf' -Pov safetyist -Model claude-sonnet-4-5 -Temperature 0.3
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- SUMMARIZATION                                                         -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-summary" id="summarization">
  <h2>Summarization</h2>

  <div class="func">
    <h4>Invoke-POVSummary</h4>
    <div class="synopsis">Processes a single source document through AI to extract a structured POV summary mapped to the taxonomy.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-DocId</code></td><td>string</td><td>Yes</td><td>Document slug ID (e.g., <code>altman-2024-agi-path</code>)</td></tr>
      <tr><td><code>-RepoRoot</code></td><td>string</td><td>No</td><td>Path to repo root</td></tr>
      <tr><td><code>-ApiKey</code></td><td>string</td><td>No</td><td>AI API key override</td></tr>
      <tr><td><code>-Model</code></td><td>string</td><td>No</td><td>AI model. Default: <code>gemini-3.1-flash-lite-preview</code></td></tr>
      <tr><td><code>-Temperature</code></td><td>double</td><td>No</td><td>Sampling temperature (0.0&ndash;1.0). Default: 0.1</td></tr>
      <tr><td><code>-DryRun</code></td><td>switch</td><td>No</td><td>Show prompt without API calls</td></tr>
      <tr><td><code>-Force</code></td><td>switch</td><td>No</td><td>Re-process even if summary is current</td></tr>
    </table>
<pre>
Invoke-POVSummary -DocId "altman-2024-agi-path"
Invoke-POVSummary -DocId "lecun-2024-critique" -DryRun
</pre>
  </div>

  <div class="func">
    <h4>Invoke-BatchSummary</h4>
    <div class="synopsis">Smart batch POV summarization across all documents needing processing.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-ForceAll</code></td><td>switch</td><td>No</td><td>Reprocess every document</td></tr>
      <tr><td><code>-DocId</code></td><td>string</td><td>No</td><td>Reprocess single document by ID</td></tr>
      <tr><td><code>-Model</code></td><td>string</td><td>No</td><td>AI model. Default: <code>gemini-3.1-flash-lite-preview</code></td></tr>
      <tr><td><code>-Temperature</code></td><td>double</td><td>No</td><td>Sampling temperature (0.0&ndash;1.0). Default: 0.1</td></tr>
      <tr><td><code>-DryRun</code></td><td>switch</td><td>No</td><td>Show plan without making API calls</td></tr>
      <tr><td><code>-MaxConcurrent</code></td><td>int</td><td>No</td><td>Parallel documents (1&ndash;10). Default: 1</td></tr>
      <tr><td><code>-SkipConflictDetection</code></td><td>switch</td><td>No</td><td>Skip conflict check after each summary</td></tr>
    </table>
<pre>
Invoke-BatchSummary
Invoke-BatchSummary -ForceAll -MaxConcurrent 3
Invoke-BatchSummary -DryRun
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- ANALYSIS                                                              -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-analysis" id="analysis">
  <h2>Analysis</h2>

  <div class="func">
    <h4>Find-Conflict</h4>
    <div class="synopsis">Factual conflict detection and deduplication for document summaries.</div>
    <p>Reads a summary's <code>factual_claims</code>, matches or creates conflict files under
    <code>conflicts/</code>, and returns an <code>AITriad.ConflictResult</code> object with counts
    (ClaimsProcessed, Appended, Created, Skipped). Idempotent&mdash;re-running skips duplicates.</p>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-DocId</code></td><td>string</td><td>Yes</td><td>Document ID to check for conflicts</td></tr>
    </table>
<pre>
Find-Conflict -DocId 'situational-awareness-decade-ahead-2026'
# Re-run is safe — duplicates are skipped
Find-Conflict -DocId 'situational-awareness-decade-ahead-2026'
</pre>
  </div>

  <div class="func">
    <h4>Find-Source</h4>
    <div class="synopsis">Finds source documents whose summaries reference given taxonomy node IDs.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-Id</code></td><td>string[]</td><td>Yes</td><td>Taxonomy node ID patterns (supports wildcards)</td></tr>
    </table>
<pre>
Find-Source -Id 'skp-methods-005'
Find-Source -Id 'skp-methods*'
Find-Source -Id 'acc-goals-001','saf-data-002'
</pre>
  </div>

  <div class="func">
    <h4>Get-TaxonomyHealth</h4>
    <div class="synopsis">Displays a diagnostic report on taxonomy coverage and usage across all summaries.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-RepoRoot</code></td><td>string</td><td>No</td><td>Path to the repository root</td></tr>
      <tr><td><code>-OutputFile</code></td><td>string</td><td>No</td><td>Write full health data as JSON to this path</td></tr>
      <tr><td><code>-Detailed</code></td><td>switch</td><td>No</td><td>Show per-node and per-document breakdowns</td></tr>
      <tr><td><code>-PassThru</code></td><td>switch</td><td>No</td><td>Return the health data hashtable for piping</td></tr>
    </table>
<pre>
Get-TaxonomyHealth
Get-TaxonomyHealth -Detailed -OutputFile health.json
$h = Get-TaxonomyHealth -PassThru
</pre>
  </div>

  <div class="func">
    <h4>Invoke-TaxonomyProposal</h4>
    <div class="synopsis">Uses AI to generate structured taxonomy improvement proposals based on health data.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-Model</code></td><td>string</td><td>No</td><td>AI model. Default: <code>gemini-3.1-flash-lite-preview</code></td></tr>
      <tr><td><code>-Temperature</code></td><td>double</td><td>No</td><td>Sampling temperature (0.0&ndash;1.0). Default: 0.3</td></tr>
      <tr><td><code>-DryRun</code></td><td>switch</td><td>No</td><td>Show prompt without API calls</td></tr>
      <tr><td><code>-OutputFile</code></td><td>string</td><td>No</td><td>Path for proposal JSON. Default: <code>taxonomy/proposals/proposal-{timestamp}.json</code></td></tr>
      <tr><td><code>-HealthData</code></td><td>hashtable</td><td>No</td><td>Pre-computed health data from <code>Get-TaxonomyHealth -PassThru</code></td></tr>
    </table>
<pre>
Invoke-TaxonomyProposal -DryRun
$h = Get-TaxonomyHealth -PassThru
Invoke-TaxonomyProposal -HealthData $h
</pre>
  </div>

  <div class="func">
    <h4>Invoke-AttributeExtraction</h4>
    <div class="synopsis">Uses AI to generate rich graph attributes for taxonomy nodes (Phase 1 of LLM Attribute Graphs).</div>
    <p>Reads taxonomy JSON files, sends nodes in batches to an LLM, and writes
    <code>graph_attributes</code> back to each node. Attributes include epistemic_type,
    rhetorical_strategy, assumes, falsifiability, audience, emotional_register,
    policy_actionability, intellectual_lineage, and steelman_vulnerability.
    Nodes that already have attributes are skipped unless <code>-Force</code> is specified.</p>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-POV</code></td><td>string</td><td>No</td><td>Process only this POV file. Default: all four</td></tr>
      <tr><td><code>-BatchSize</code></td><td>int</td><td>No</td><td>Nodes per API call (1&ndash;20). Default: 8</td></tr>
      <tr><td><code>-Model</code></td><td>string</td><td>No</td><td>AI model. Default: <code>gemini-2.5-flash</code></td></tr>
      <tr><td><code>-ApiKey</code></td><td>string</td><td>No</td><td>Explicit API key override</td></tr>
      <tr><td><code>-Temperature</code></td><td>double</td><td>No</td><td>Sampling temperature (0.0&ndash;1.0). Default: 0.2</td></tr>
      <tr><td><code>-DryRun</code></td><td>switch</td><td>No</td><td>Show first batch prompt without calling AI</td></tr>
      <tr><td><code>-Force</code></td><td>switch</td><td>No</td><td>Regenerate attributes even if already present</td></tr>
    </table>
<pre>
Invoke-AttributeExtraction -DryRun
Invoke-AttributeExtraction -POV accelerationist
Invoke-AttributeExtraction -Force -Model gemini-2.5-pro
</pre>
  </div>

  <div class="func">
    <h4>Compare-Taxonomy</h4>
    <div class="synopsis">Visually compare two taxonomy directories side-by-side in an HTML report.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-ReferenceDir</code></td><td>string</td><td>Yes</td><td>Path to the first (reference) taxonomy directory</td></tr>
      <tr><td><code>-DifferenceDir</code></td><td>string</td><td>Yes</td><td>Path to the second (difference) taxonomy directory</td></tr>
      <tr><td><code>-PassThru</code></td><td>switch</td><td>No</td><td>Return file path instead of opening browser</td></tr>
    </table>
<pre>
Compare-Taxonomy ./taxonomy/Origin ./taxonomy/Proposed
</pre>
  </div>

  <div class="func">
    <h4>Invoke-PIIAudit</h4>
    <div class="synopsis">Pre-public PII scanner for the AI Triad research repository.</div>
    <p>No parameters. Scans for email addresses, phone numbers, private file paths, and fields that should only exist in a private rolodex.</p>
<pre>
Invoke-PIIAudit
Invoke-PIIAudit -Verbose
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- UTILITIES                                                             -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-util" id="utilities">
  <h2>Utilities</h2>

  <div class="func">
    <h4>Save-Source</h4>
    <div class="synopsis">Copies raw source documents to a target directory.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-Directory</code></td><td>string</td><td>Yes</td><td>Target directory (created if missing)</td></tr>
      <tr><td><code>-DocId</code></td><td>string[]</td><td>Yes</td><td>Document IDs to copy (accepts pipeline input)</td></tr>
    </table>
<pre>
Save-Source -Directory './export' -DocId 'ai-as-normal-technology-2026'
Find-Source -Id 'skp-methods-005' | Save-Source -Directory './export'
</pre>
  </div>

  <div class="func">
    <h4>Save-WaybackUrl</h4>
    <div class="synopsis">Submits a URL to the Wayback Machine (Internet Archive) for archival.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-Url</code></td><td>string</td><td>Yes</td><td>The URL to submit</td></tr>
    </table>
<pre>
Save-WaybackUrl -Url 'https://example.com/important-article'
</pre>
  </div>

  <div class="func">
    <h4>Update-Snapshot</h4>
    <div class="synopsis">Re-generates snapshot.md for all existing sources using updated conversion logic.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-DryRun</code></td><td>switch</td><td>No</td><td>Preview conversions without writing files</td></tr>
    </table>
<pre>
Update-Snapshot
Update-Snapshot -DryRun
Redo-Snapshots          # backward-compatible alias
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- APP LAUNCHERS                                                         -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-app" id="launchers">
  <h2>App Launchers</h2>

  <p>All three Electron apps support <strong>Light</strong>, <strong>Dark</strong>,
  <strong>BKC</strong> (Berkman Klein Center), and <strong>Auto</strong> (system preference) color schemes.
  Theme selection is persisted across sessions.</p>

  <div class="func">
    <h4>Start-TaxonomyEditor</h4>
    <div class="synopsis">Launches the Taxonomy Editor Electron app.</div>
    <p>Features: node editing, semantic search, "Analyze Distinction" AI comparison,
    taxonomy proposals. Default AI model: <code>gemini-3.1-flash-lite-preview</code> (configurable in Settings).
    Embeddings use pre-computed local vectors from <code>embeddings.json</code>; saving a node
    automatically re-computes its embedding via <code>all-MiniLM-L6-v2</code>.</p>
    <p>Alias: <code>TaxonomyEditor</code></p>
<pre>
Start-TaxonomyEditor
</pre>
  </div>

  <div class="func">
    <h4>Start-POViewer</h4>
    <div class="synopsis">Launches the POV Viewer Electron app.</div>
    <p>Alias: <code>POViewer</code></p>
<pre>
Start-POViewer
</pre>
  </div>

  <div class="func">
    <h4>Start-SummaryViewer</h4>
    <div class="synopsis">Launches the Summary Viewer Electron app.</div>
    <p>Features: source browsing, key-point exploration, document search with highlighting,
    semantic similarity search. Embeddings use <code>gemini-embedding-001</code> via Gemini API.</p>
    <p>Alias: <code>SummaryViewer</code></p>
<pre>
Start-SummaryViewer
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- HELP                                                                  -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card cat-help" id="help">
  <h2>Help</h2>

  <div class="func">
    <h4>Show-AITriadHelp</h4>
    <div class="synopsis">Generates this HTML reference page and opens it in the default browser.</div>
    <table>
      <tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>
      <tr><td><code>-PassThru</code></td><td>switch</td><td>No</td><td>Return file path instead of opening browser</td></tr>
    </table>
<pre>
Show-AITriadHelp
Show-AITriadHelp -PassThru
</pre>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- ALIASES                                                               -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card" id="aliases">
  <h2>Aliases</h2>
  <table>
    <tr><th>Alias</th><th>Target Function</th></tr>
    <tr><td><code>Import-Document</code></td><td><code>Import-AITriadDocument</code></td></tr>
    <tr><td><code>TaxonomyEditor</code></td><td><code>Start-TaxonomyEditor</code></td></tr>
    <tr><td><code>POViewer</code></td><td><code>Start-POViewer</code></td></tr>
    <tr><td><code>SummaryViewer</code></td><td><code>Start-SummaryViewer</code></td></tr>
    <tr><td><code>Redo-Snapshots</code></td><td><code>Update-Snapshot</code></td></tr>
  </table>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- SUPPORTED AI MODELS                                                   -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card" id="models">
  <h2>Supported AI Models</h2>

  <h3>Gemini (Google)</h3>
  <table>
    <tr><th>Model Name</th><th>API Model ID</th><th>Note</th></tr>
    <tr><td><code>gemini-3.1-flash-lite-preview</code></td><td>gemini-3.1-flash-lite-preview</td><td><strong>Default</strong></td></tr>
    <tr><td><code>gemini-2.5-flash</code></td><td>gemini-2.5-flash</td><td></td></tr>
    <tr><td><code>gemini-2.5-flash-lite</code></td><td>gemini-2.5-flash-lite</td><td></td></tr>
    <tr><td><code>gemini-2.5-pro</code></td><td>gemini-2.5-pro</td><td></td></tr>
  </table>

  <h3>Claude (Anthropic)</h3>
  <table>
    <tr><th>Model Name</th><th>API Model ID</th></tr>
    <tr><td><code>claude-opus-4</code></td><td>claude-opus-4-20250514</td></tr>
    <tr><td><code>claude-sonnet-4-5</code></td><td>claude-sonnet-4-5-20250514</td></tr>
    <tr><td><code>claude-haiku-3.5</code></td><td>claude-3-5-haiku-20241022</td></tr>
  </table>
  <p><em>Note:</em> Claude 4.6 models (Opus 4.6, Sonnet 4.6) are available via the Anthropic API.
  Use model IDs <code>claude-opus-4-6</code> and <code>claude-sonnet-4-6</code>.</p>

  <h3>Embedding Models</h3>
  <table>
    <tr><th>Context</th><th>Model</th><th>Dimensions</th></tr>
    <tr><td>PowerShell CLI (<code>Get-Tax -Similar</code>)</td><td><code>all-MiniLM-L6-v2</code> (local)</td><td>384</td></tr>
    <tr><td>Taxonomy Editor</td><td><code>all-MiniLM-L6-v2</code> (local, via <code>embeddings.json</code>)</td><td>384</td></tr>
    <tr><td>Summary Viewer</td><td><code>gemini-embedding-001</code> (API)</td><td>768</td></tr>
  </table>
  <p>All embedding systems encode the taxonomy node <strong>description only</strong> for POV nodes.
  Cross-cutting nodes in the Taxonomy Editor additionally include POV interpretations.
  Conflict nodes include claim label, description, and human notes.</p>

  <h3>Groq</h3>
  <table>
    <tr><th>Model Name</th><th>API Model ID</th></tr>
    <tr><td><code>groq-llama-3.3-70b</code></td><td>llama-3.3-70b-versatile</td></tr>
    <tr><td><code>groq-llama-4-scout</code></td><td>meta-llama/llama-4-scout-17b-16e-instruct</td></tr>
  </table>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- CI/CD WORKFLOW                                                        -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card" id="cicd">
  <h2>CI/CD Workflow</h2>
  <p>
    The <code>batch-summarize.yml</code> GitHub Actions workflow triggers on pushes
    to <code>main</code> that modify the <code>TAXONOMY_VERSION</code> file.
    It runs <code>Invoke-BatchSummary</code> on an Ubuntu runner with a
    120-minute timeout to re-process documents affected by taxonomy changes.
  </p>
<pre>
# Trigger: push to main with changes to TAXONOMY_VERSION
# Runner:  ubuntu-latest
# Timeout: 120 minutes
</pre>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<!-- ENVIRONMENT VARIABLES                                                 -->
<!-- ═══════════════════════════════════════════════════════════════════════ -->
<div class="card" id="envvars">
  <h2>Environment Variables</h2>
  <table>
    <tr><th>Variable</th><th>Purpose</th></tr>
    <tr><td><code>AI_API_KEY</code></td><td>Universal fallback API key (used if backend-specific key is not set)</td></tr>
    <tr><td><code>AI_MODEL</code></td><td>Override default model (e.g., <code>claude-sonnet-4-5</code>)</td></tr>
    <tr><td><code>GEMINI_API_KEY</code></td><td>Google Gemini API key</td></tr>
    <tr><td><code>ANTHROPIC_API_KEY</code></td><td>Anthropic Claude API key</td></tr>
    <tr><td><code>GROQ_API_KEY</code></td><td>Groq API key</td></tr>
  </table>
</div>

<div class="footer">
  Generated by <code>Show-AITriadHelp</code> &middot; AITriad v{{VERSION}}
</div>

</div>
</body>
</html>
'@

    # Replace placeholders with live values
    $Html = $Html -replace '{{VERSION}}',   $Version
    $Html = $Html -replace '{{GENERATED}}', $Generated

    # Write to temp directory with a fixed filename
    $TempDir  = [System.IO.Path]::GetTempPath()
    $TempPath = Join-Path $TempDir 'AITriad-Help.html'
    Set-Content -Path $TempPath -Value $Html -Encoding utf8

    # Copy hero image alongside HTML so the relative src works
    $HeroSource = Join-Path $script:RepoRoot 'docs' 'AITriad-Module.png'
    if (-not (Test-Path $HeroSource)) {
        # Fallback: check Downloads (original location)
        $HeroSource = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads' 'AITriadModule.png'
    }
    if (Test-Path $HeroSource) {
        Copy-Item -Path $HeroSource -Destination (Join-Path $TempDir 'AITriad-Module.png') -Force
    }

    if ($PassThru) {
        return $TempPath
    }

    # Open in default browser (cross-platform, PS 7+)
    if ($IsWindows) {
        Start-Process $TempPath
    }
    elseif ($IsMacOS) {
        Start-Process 'open' -ArgumentList $TempPath
    }
    elseif ($IsLinux) {
        Start-Process 'xdg-open' -ArgumentList $TempPath
    }
}
