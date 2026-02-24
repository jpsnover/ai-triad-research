#Requires -Version 7.0
<#
.SYNOPSIS
    AI Triad document ingestion script.

.DESCRIPTION
    Ingests a document into the AI Triad repository.

    What this script does:
        1. Generates a stable doc-id slug from the title/URL.
        2. Creates sources/<doc-id>/raw/ and saves the original file.
        3. Converts to Markdown snapshot (sources/<doc-id>/snapshot.md).
        4. Creates sources/<doc-id>/metadata.json with summary_status: pending.
        5. Optionally triggers Wayback Machine save (fire-and-forget).
        6. Prints the doc-id for use in follow-up commands.

.PARAMETER Url
    URL of web article to ingest.

.PARAMETER File
    Path to a local PDF/DOCX/HTML file to ingest.

.PARAMETER Inbox
    Process all files in sources/_inbox/.

.PARAMETER Pov
    One or more POV tags: accelerationist, safetyist, skeptic, cross-cutting.

.PARAMETER Topic
    One or more topic tags.

.PARAMETER SkipWayback
    Skip the Wayback Machine archival submission.

.PARAMETER NoSummaryQueue
    Do not mark the document for AI summarisation (leave summary_status as pending
    but do not touch the queue file used by batch_summarize).

.EXAMPLE
    .\scripts\Import-Document.ps1 -Url 'https://example.com/article' -Pov accelerationist, skeptic

.EXAMPLE
    .\scripts\Import-Document.ps1 -Url 'https://example.com/article' -Pov safetyist -Topic alignment, governance

.EXAMPLE
    .\scripts\Import-Document.ps1 -Inbox

.EXAMPLE
    .\scripts\Import-Document.ps1 -File 'path/to/file.pdf' -Pov skeptic

.PARAMETER SkipAiMeta
    Skip the Gemini metadata-enrichment step. Title, authors, date, and tag
    suggestions will fall back to regex/filename heuristics only.

.PARAMETER GeminiModel
    Gemini model to use for metadata enrichment.
    Default: gemini-2.5-flash-lite  (fast and cheap for this extraction task).

.NOTES
    AI enrichment:
        Set the environment variable AI_API_KEY to your Gemini API key.
        If the variable is absent or the call fails the script degrades gracefully
        and continues with heuristic metadata only.

        $env:AI_API_KEY = 'AIza...'

    External tool dependencies (all optional — the script degrades gracefully if absent):
        pandoc      : highest-quality HTML/DOCX → Markdown conversion.  https://pandoc.org
        pdftotext   : PDF text extraction (part of poppler-utils).       https://poppler.freedesktop.org
        mutool      : alternative PDF extraction (part of mupdf-tools).  https://mupdf.com
#>

[CmdletBinding(DefaultParameterSetName = 'ByUrl')]
param(
    [Parameter(ParameterSetName = 'ByUrl', Mandatory)]
    [string]$Url,

    [Parameter(ParameterSetName = 'ByFile', Mandatory)]
    [ValidateScript({ Test-Path $_ })]
    [string]$File,

    [Parameter(ParameterSetName = 'ByInbox', Mandatory)]
    [switch]$Inbox,

    [Parameter(ParameterSetName = 'ByUrl')]
    [Parameter(ParameterSetName = 'ByFile')]
    [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting')]
    [string[]]$Pov = @(),

    [Parameter(ParameterSetName = 'ByUrl')]
    [Parameter(ParameterSetName = 'ByFile')]
    [string[]]$Topic = @(),

    [switch]$SkipWayback,

    [switch]$NoSummaryQueue,

    [switch]$SkipAiMeta,

    [switch]$NoSummarize,

    [ValidateSet(
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-pro'
    )]
    [string]$GeminiModel = 'gemini-2.5-flash-lite'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─────────────────────────────────────────────────────────────────────────────
# Gemini API key  (read once at startup; absence is non-fatal)
# ─────────────────────────────────────────────────────────────────────────────
$Script:GeminiApiKey = $env:AI_API_KEY

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SourcesDir = Join-Path $RepoRoot 'sources'
$InboxDir   = Join-Path $SourcesDir '_inbox'
$QueueFile  = Join-Path $RepoRoot '.summarise-queue.json'

# ─────────────────────────────────────────────────────────────────────────────
# Console helpers
# ─────────────────────────────────────────────────────────────────────────────
function Write-Step { param([string]$M) Write-Host "`n▶  $M"    -ForegroundColor Cyan   }
function Write-OK   { param([string]$M) Write-Host "   ✓  $M"  -ForegroundColor Green  }
function Write-Warn { param([string]$M) Write-Host "   ⚠  $M"  -ForegroundColor Yellow }
function Write-Fail { param([string]$M) Write-Host "   ✗  $M"  -ForegroundColor Red    }
function Write-Info { param([string]$M) Write-Host "   →  $M"  -ForegroundColor Gray   }

# ─────────────────────────────────────────────────────────────────────────────
# Document conversion functions (loaded from external module to avoid AMSI
# false positives triggered by HTML-parsing regex + web-fetch patterns)
# ─────────────────────────────────────────────────────────────────────────────
Import-Module (Join-Path $PSScriptRoot 'DocConverters.psm1') -Force

# ─────────────────────────────────────────────────────────────────────────────
# Slug generation
# ─────────────────────────────────────────────────────────────────────────────
function New-Slug {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Text,
        [int]$MaxLength = 60
    )

    # Normalise Unicode → ASCII approximation where possible
    $Normalized = $Text.Normalize([System.Text.NormalizationForm]::FormD)
    $AsciiOnly  = [System.Text.StringBuilder]::new()
    foreach ($c in $Normalized.ToCharArray()) {
        $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($c)
        if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$AsciiOnly.Append($c)
        }
    }

    $Slug = $AsciiOnly.ToString().ToLower()
    $Slug = [regex]::Replace($Slug, '[^\w\s\-]', '')   # keep word chars, spaces, hyphens
    $Slug = [regex]::Replace($Slug, '[\s_]+', '-')     # collapse whitespace to hyphens
    $Slug = $Slug.Trim('-')

    # Remove common stop-words that pad slugs without adding meaning
    $StopWords = @('\bthe\b', '\ba\b', '\ban\b', '\band\b', '\bof\b', '\bin\b',
                   '\bto\b', '\bfor\b', '\bwith\b', '\bon\b', '\bat\b')
    foreach ($sw in $StopWords) {
        $Slug = [regex]::Replace($Slug, $sw, '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    $Slug = [regex]::Replace($Slug, '-{2,}', '-').Trim('-')

    if ($Slug.Length -gt $MaxLength) {
        # Cut at last hyphen before limit so we don't split a word mid-stream
        $Slug = $Slug.Substring(0, $MaxLength)
        $lastHyphen = $Slug.LastIndexOf('-')
        if ($lastHyphen -gt 10) { $Slug = $Slug.Substring(0, $lastHyphen) }
    }

    if ([string]::IsNullOrWhiteSpace($Slug)) { $Slug = 'document' }
    return $Slug
}

# ─────────────────────────────────────────────────────────────────────────────
# Unique doc-id: append YYYY and a suffix if slug already exists on disk
# ─────────────────────────────────────────────────────────────────────────────
function Resolve-DocId {
    param(
        [string]$BaseSlug,
        [string]$Year = (Get-Date -Format 'yyyy')
    )

    $Candidate = "$BaseSlug-$Year"
    $Counter   = 1
    while (Test-Path (Join-Path $SourcesDir $Candidate)) {
        $Candidate = "$BaseSlug-$Year-$Counter"
        $Counter++
    }
    return $Candidate
}

# ─────────────────────────────────────────────────────────────────────────────
# Metadata factory
# ─────────────────────────────────────────────────────────────────────────────
function New-Metadata {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$DocId,
        [Parameter(Mandatory)][string]$Title,
        [string]  $DocumentUrl  = '',
        [string[]]$Author       = @(),
        [string]  $SourceType   = 'unknown',
        [string[]]$PovTag       = @(),
        [string[]]$TopicTag     = @()
    )

    return [ordered]@{
        id                 = $DocId
        title              = $Title
        url                = $DocumentUrl
        authors            = $Author
        date_published     = $null
        date_ingested      = (Get-Date -Format 'yyyy-MM-dd')
        source_type        = $SourceType
        pov_tags           = $PovTag
        topic_tags         = $TopicTag
        rolodex_author_ids = @()
        archive_status     = 'pending'
        summary_version    = $null
        summary_status     = 'pending'
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Add snapshot header (provenance block prepended to every snapshot.md)
# ─────────────────────────────────────────────────────────────────────────────
function Add-SnapshotHeader {
    param(
        [string]$Markdown,
        [string]$Title,
        [string]$SourceUrl  = '',
        [string]$SourceType = '',
        [string]$CapturedAt = (Get-Date -Format 'yyyy-MM-dd')
    )

    $Header = @"
<!--
  AI Triad Research Project — Document Snapshot
  Title      : $Title
  Source     : $SourceUrl
  Type       : $SourceType
  Captured   : $CapturedAt
  This file is a Markdown shadow copy for AI summarisation and POViewer display.
  The original file lives in raw/ for fidelity (charts, tables, exact layout).
-->

# $Title

> **Snapshot captured:** $CapturedAt
> **Source:** $SourceUrl
> **Type:** $SourceType

---

"@
    return $Header + $Markdown
}

# ─────────────────────────────────────────────────────────────────────────────
# Queue the doc-id for batch summarisation
# ─────────────────────────────────────────────────────────────────────────────
function Add-ToSummaryQueue {
    param([string]$DocId)

    $Queue = @()
    if (Test-Path $QueueFile) {
        try { $Queue = Get-Content $QueueFile -Raw | ConvertFrom-Json } catch {}
        if ($null -eq $Queue) { $Queue = @() }
    }
    if ($DocId -notin $Queue) {
        $Queue += $DocId
        $Queue | ConvertTo-Json | Set-Content $QueueFile -Encoding UTF8
        Write-Info "Added to summary queue: $QueueFile"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Wayback Machine save (fire-and-forget background job)
# ─────────────────────────────────────────────────────────────────────────────
function Submit-ToWaybackMachine {
    param([string]$TargetUrl)

    $SaveUrl = "https://web.archive.org/save/$TargetUrl"
    Write-Info "Submitting to Wayback Machine..."

    try {
        Invoke-RestMethod -Uri $SaveUrl -Method GET -TimeoutSec 15 -ErrorAction Stop | Out-Null
        Write-OK "Wayback: archive request sent"
    } catch {
        Write-Warn "Wayback: request failed (non-fatal) — $($_.Exception.Message)"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Gemini API functions (loaded from external module to avoid AMSI false positives)
# ─────────────────────────────────────────────────────────────────────────────
Import-Module (Join-Path $PSScriptRoot 'GeminiEnrich.psm1') -Force

# ─────────────────────────────────────────────────────────────────────────────
# Core ingest function — called once per document
# ─────────────────────────────────────────────────────────────────────────────
function Invoke-IngestDocument {
    [CmdletBinding()]
    param(
        [string]  $SourceUrl   = '',
        [string]  $SourceFile  = '',
        [string[]]$PovTags     = @(),
        [string[]]$TopicTags   = @()
    )
    # ── Determine source type and fetch/read content ──────────────────────────
    $RawContent  = $null   # raw bytes or string saved to raw/
    $MarkdownText= ''
    $Title       = ''
    $Authors     = @()
    $SourceType  = 'unknown'
    $RawExtension= ''
    $IsUrl       = -not [string]::IsNullOrWhiteSpace($SourceUrl)

    if ($IsUrl) {
        # ── URL ingestion ────────────────────────────────────────────────────
        Write-Step "Fetching URL: $SourceUrl"
        $SourceType = 'web_article'
        $RawExtension = '.html'

        try {
            $TempHtml = [System.IO.Path]::GetTempFileName() + '.html'
            $WebHeaders = @{ 'User-Agent' = 'Mozilla/5.0 (AI Triad Research Bot; +https://cyber.harvard.edu)' }
            Invoke-RestMethod -Uri $SourceUrl -OutFile $TempHtml -TimeoutSec 30 -Headers $WebHeaders -ErrorAction Stop
            $HtmlContent = Get-Content -Path $TempHtml -Raw -Encoding UTF8
            Remove-Item $TempHtml -Force -ErrorAction SilentlyContinue
            Write-OK "Fetched $([int]$HtmlContent.Length) characters"
        } catch {
            Remove-Item $TempHtml -Force -ErrorAction SilentlyContinue
            Write-Fail "Failed to fetch URL: $_"
            throw
        }

        # Extract meta
        $Meta    = Get-HtmlMeta -Html $HtmlContent
        $Title   = if ($Meta.Title) { $Meta.Title } else { $SourceUrl }
        $Authors = $Meta.Author

        # Convert to Markdown
        $MarkdownText = ConvertFrom-Html -Html $HtmlContent -SourceUrl $SourceUrl
        $RawContent   = $HtmlContent

        # Detect if it looks like a PDF link
        if ($SourceUrl -match '\.pdf(\?.*)?$') {
            Write-Info "URL points to a PDF — attempting direct PDF download"
            try {
                $TempPdf = [System.IO.Path]::GetTempFileName() + '.pdf'
                Invoke-RestMethod -Uri $SourceUrl -OutFile $TempPdf -TimeoutSec 60 -ErrorAction Stop
                $RawContent   = [System.IO.File]::ReadAllBytes($TempPdf)
                $MarkdownText = ConvertFrom-Pdf -PdfPath $TempPdf
                Remove-Item $TempPdf -Force
                $RawExtension = '.pdf'
                $SourceType   = 'pdf'
            } catch {
                Write-Warn "PDF download failed, falling back to HTML content: $_"
                Remove-Item $TempPdf -Force -ErrorAction SilentlyContinue
            }
        }

    } else {
        # ── Local file ingestion ──────────────────────────────────────────────
        $ResolvedFile = Resolve-Path $SourceFile
        $Ext = [System.IO.Path]::GetExtension($ResolvedFile).ToLower()
        $RawExtension = $Ext

        Write-Step "Ingesting file: $ResolvedFile"
        $RawContent = [System.IO.File]::ReadAllBytes($ResolvedFile)

        switch ($Ext) {
            '.pdf' {
                $SourceType   = 'pdf'
                $MarkdownText = ConvertFrom-Pdf -PdfPath $ResolvedFile
                # Best-effort title from filename
                $Title = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
            }
            { $_ -in '.docx', '.doc' } {
                $SourceType   = 'docx'
                $MarkdownText = ConvertFrom-Docx -DocxPath $ResolvedFile
                $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
            }
            { $_ -in '.html', '.htm' } {
                $SourceType   = 'web_article'
                $HtmlContent  = [System.IO.File]::ReadAllText($ResolvedFile)
                $Meta         = Get-HtmlMeta -Html $HtmlContent
                $Title        = if ($Meta.Title) { $Meta.Title } else {
                    [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) }
                $Authors      = $Meta.Author
                $MarkdownText = ConvertFrom-Html -Html $HtmlContent
            }
            { $_ -in '.md', '.txt' } {
                $SourceType   = if ($Ext -eq '.md') { 'markdown' } else { 'plaintext' }
                $MarkdownText = [System.IO.File]::ReadAllText($ResolvedFile)
                $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
                # Try to extract title from first H1
                $H1Match = [regex]::Match($MarkdownText, '(?m)^#\s+(.+)$')
                if ($H1Match.Success) { $Title = $H1Match.Groups[1].Value.Trim() }
            }
            Default {
                Write-Warn "Unsupported file type '$Ext' — storing raw, no Markdown conversion"
                $SourceType   = 'unknown'
                $MarkdownText = "# $(Split-Path $ResolvedFile -Leaf)`n`n[Binary file — no text extraction available]"
                $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile)
            }
        }

        Write-OK "Read $($RawContent.Length) bytes from file"
    }

    # ── Gemini metadata enrichment ────────────────────────────────────────────
    # Runs after document text is available regardless of source type.
    # AI-extracted values are used when:
    #   • title    : always preferred over heuristic fallback if non-empty
    #   • authors  : always preferred over regex fallback if non-empty
    #   • date     : only Gemini can extract this reliably
    #   • pov_tags : used ONLY when user did not supply -Pov flags
    #   • topics   : MERGED with user-supplied -Topic flags (union, deduplicated)
    #   • one_liner: stored as a new metadata field for quick reference

    $AiMeta = $null

    if (-not $SkipAiMeta -and -not [string]::IsNullOrWhiteSpace($Script:GeminiApiKey)) {
        try {
            $AiMeta = Get-GeminiMetadata `
                -MarkdownText  $MarkdownText `
                -SourceUrl     $SourceUrl `
                -FallbackTitle $Title `
                -Model         $GeminiModel `
                -ApiKey        $Script:GeminiApiKey
        } catch {
            Write-Warn "Gemini enrichment threw an exception — continuing with heuristics: $_"
            $AiMeta = $null
        }
    } elseif ($SkipAiMeta) {
        Write-Info "Skipping Gemini enrichment (-SkipAiMeta)"
    } else {
        Write-Warn "AI_API_KEY not set — metadata enrichment skipped. Set `$env:AI_API_KEY to enable."
    }

    # Merge AI results with heuristic values and user-supplied flags
    if ($null -ne $AiMeta) {
        # Title: prefer AI over heuristic
        if (-not [string]::IsNullOrWhiteSpace($AiMeta.title)) { $Title = $AiMeta.title }

        # Authors: prefer AI over regex
        $AiAuthors = @($AiMeta.authors | Where-Object { $_ })
        if ($AiAuthors.Count -gt 0) { $Authors = $AiAuthors }

        # POV tags: AI suggestions used only when user supplied none
        $AiPovTags = @($AiMeta.pov_tags | Where-Object { $_ })
        if ($PovTags.Count -eq 0 -and $AiPovTags.Count -gt 0) {
            $PovTags = $AiPovTags
            Write-Info "POV tags from Gemini: $($PovTags -join ', ')"
        } elseif ($PovTags.Count -gt 0) {
            Write-Info "POV tags from -Pov flag (Gemini suggestion ignored): $($PovTags -join ', ')"
        }

        # Topic tags: merge user-supplied and AI-suggested (union, deduplicated)
        $MergedTopics = @($TopicTags) + @($AiMeta.topic_tags) |
            Select-Object -Unique |
            Where-Object { $_ }
        $TopicTags = $MergedTopics
        if ($TopicTags.Count -gt 0) {
            Write-Info "Topic tags (merged): $($TopicTags -join ', ')"
        }
    }

    # ── Generate doc-id ───────────────────────────────────────────────────────
    $SlugSource = if ($IsUrl) { $Title } else { $Title }
    if ([string]::IsNullOrWhiteSpace($SlugSource)) {
        $SlugSource = if ($IsUrl) { $SourceUrl } else { [System.IO.Path]::GetFileNameWithoutExtension($SourceFile) }
    }
    $BaseSlug = New-Slug -Text $SlugSource
    $DocId    = Resolve-DocId -BaseSlug $BaseSlug

    Write-OK "Doc ID: $DocId"

    # ── Create directory structure ────────────────────────────────────────────
    $DocDir = Join-Path $SourcesDir $DocId
    $RawDir = Join-Path $DocDir 'raw'
    New-Item -ItemType Directory -Path $RawDir -Force | Out-Null
    Write-OK "Created: sources/$DocId/"

    # ── Save raw file ─────────────────────────────────────────────────────────
    $RawFilename = if ($IsUrl) {
        'original' + $RawExtension
    } else {
        [System.IO.Path]::GetFileName($SourceFile)
    }
    $RawPath = Join-Path $RawDir $RawFilename

    if ($RawContent -is [byte[]]) {
        Set-Content -Path $RawPath -Value $RawContent -AsByteStream
    } else {
        Set-Content -Path $RawPath -Value $RawContent -Encoding UTF8
    }
    Write-OK "Raw file saved: raw/$RawFilename"

    # ── Add provenance header and write snapshot.md ───────────────────────────
    $FinalMarkdown = Add-SnapshotHeader `
        -Markdown    $MarkdownText `
        -Title       $Title `
        -SourceUrl   $SourceUrl `
        -SourceType  $SourceType `
        -CapturedAt  (Get-Date -Format 'yyyy-MM-dd')

    $SnapshotPath = Join-Path $DocDir 'snapshot.md'
    Set-Content -Path $SnapshotPath -Value $FinalMarkdown -Encoding UTF8
    Write-OK "Snapshot written: snapshot.md ($([int]$FinalMarkdown.Length) chars)"

    # ── Write metadata.json ───────────────────────────────────────────────────
    $Metadata = New-Metadata `
        -DocId       $DocId `
        -Title       $Title `
        -DocumentUrl $SourceUrl `
        -Author      $Authors `
        -SourceType  $SourceType `
        -PovTag      $PovTags `
        -TopicTag    $TopicTags

    # Patch in AI-only fields that New-Metadata can't supply
    if ($null -ne $AiMeta) {
        if ($AiMeta.date_published) { $Metadata['date_published'] = $AiMeta.date_published }
        if ($AiMeta.one_liner)      { $Metadata['one_liner']      = $AiMeta.one_liner }
    }

    $MetaPath = Join-Path $DocDir 'metadata.json'
    $Metadata | ConvertTo-Json -Depth 5 | Set-Content -Path $MetaPath -Encoding UTF8
    Write-OK "Metadata written: metadata.json"

    # ── Summary queue ─────────────────────────────────────────────────────────
    if (-not $NoSummaryQueue) {
        Add-ToSummaryQueue -DocId $DocId
    }

    # ── Wayback Machine ───────────────────────────────────────────────────────
    if ($IsUrl -and -not $SkipWayback) {
        Submit-ToWaybackMachine -TargetUrl $SourceUrl
    }

    # ── Done ──────────────────────────────────────────────────────────────────
    Write-Host ''
    Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Ingested: $DocId" -ForegroundColor Green
    Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  sources/$DocId/" -ForegroundColor White
    Write-Host "    ├── raw/$RawFilename" -ForegroundColor Gray
    Write-Host "    ├── snapshot.md" -ForegroundColor Gray
    Write-Host "    └── metadata.json  (summary_status: pending)" -ForegroundColor Gray
    Write-Host ''

    # Return the doc-id so callers can chain commands
    return $DocId
}

# ─────────────────────────────────────────────────────────────────────────────
# Entry points — dispatch based on parameter set
# ─────────────────────────────────────────────────────────────────────────────

switch ($PSCmdlet.ParameterSetName) {

    'ByUrl' {
        $DocId = Invoke-IngestDocument `
            -SourceUrl   $Url `
            -PovTags     $Pov `
            -TopicTags   $Topic

        if (-not $NoSummarize -and $DocId) {
            $BatchScript = Join-Path $PSScriptRoot 'Invoke-BatchSummary.ps1'
            Write-Step "Running POV summarization for $DocId"
            & $BatchScript -DocId $DocId
        }
    }

    'ByFile' {
        $DocId = Invoke-IngestDocument `
            -SourceFile  $File `
            -PovTags     $Pov `
            -TopicTags   $Topic

        if (-not $NoSummarize -and $DocId) {
            $BatchScript = Join-Path $PSScriptRoot 'Invoke-BatchSummary.ps1'
            Write-Step "Running POV summarization for $DocId"
            & $BatchScript -DocId $DocId
        }
    }

    'ByInbox' {
        # ── Process all files dropped into sources/_inbox/ ────────────────────
        if (-not (Test-Path $InboxDir)) {
            Write-Fail "Inbox directory not found: $InboxDir"
            exit 1
        }

        $InboxFiles = Get-ChildItem -Path $InboxDir -File |
            Where-Object { $_.Name -ne '.gitkeep' }

        if ($InboxFiles.Count -eq 0) {
            Write-Warn "Inbox is empty: $InboxDir"
            Write-Info "Drop files into sources/_inbox/ and re-run with -Inbox"
            exit 0
        }

        Write-Step "Processing $($InboxFiles.Count) file(s) from inbox"
        $IngestedIds = @()

        foreach ($InboxFile in $InboxFiles) {
            Write-Host ''
            Write-Host "  Processing: $($InboxFile.Name)" -ForegroundColor White
            Write-Host "  $('─' * 48)" -ForegroundColor DarkGray

            # Read sidecar metadata if present: MyFile.pdf.meta.json
            $SidecarPath = $InboxFile.FullName + '.meta.json'
            $SidecarPov  = @()
            $SidecarTopic= @()

            if (Test-Path $SidecarPath) {
                try {
                    $Sidecar     = Get-Content $SidecarPath -Raw | ConvertFrom-Json
                    $SidecarPov  = if ($Sidecar.pov_tags)   { $Sidecar.pov_tags }   else { @() }
                    $SidecarTopic= if ($Sidecar.topic_tags) { $Sidecar.topic_tags } else { @() }
                    Write-Info "Sidecar found: pov=$($SidecarPov -join ',')  topics=$($SidecarTopic -join ',')"
                } catch {
                    Write-Warn "Sidecar parse failed, ignoring: $SidecarPath"
                }
            }

            try {
                $DocId = Invoke-IngestDocument `
                    -SourceFile $InboxFile.FullName `
                    -PovTags    $SidecarPov `
                    -TopicTags  $SidecarTopic

                $IngestedIds += $DocId

                # Move processed file out of inbox (to avoid re-processing)
                Remove-Item $InboxFile.FullName -Force
                if (Test-Path $SidecarPath) { Remove-Item $SidecarPath -Force }

            } catch {
                Write-Fail "Failed to ingest $($InboxFile.Name): $_"
                Write-Info "File left in inbox for retry."
            }
        }

        Write-Host ''
        Write-Host "  Inbox complete. Ingested $($IngestedIds.Count) document(s):" -ForegroundColor Cyan
        foreach ($id in $IngestedIds) {
            Write-Host "    • $id" -ForegroundColor Green
        }
        Write-Host ''

        if (-not $NoSummarize -and $IngestedIds.Count -gt 0) {
            $BatchScript = Join-Path $PSScriptRoot 'Invoke-BatchSummary.ps1'
            foreach ($id in $IngestedIds) {
                Write-Step "Running POV summarization for $id"
                & $BatchScript -DocId $id
            }
        }
    }
}

exit 0
