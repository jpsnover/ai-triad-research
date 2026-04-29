# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Import-AITriadDocument {
    <#
    .SYNOPSIS
        AI Triad document ingestion.
    .DESCRIPTION
        Ingests a document into the AI Triad repository.

        What this function does:
            1. Generates a stable doc-id slug from the title/URL.
            2. Creates sources/<doc-id>/raw/ and saves the original file.
            3. Converts to Markdown snapshot (sources/<doc-id>/snapshot.md).
            4. Creates sources/<doc-id>/metadata.json with summary_status: pending.
            5. Optionally triggers Wayback Machine save (fire-and-forget).
            6. Returns the doc-id for use in follow-up commands.
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
        Do not mark the document for AI summarisation.
    .PARAMETER SkipAiMeta
        Skip the AI metadata-enrichment step.
    .PARAMETER Model
        AI model to use for metadata enrichment and summarization.
        Supports Gemini, Claude, and Groq backends.
        Default: gemini-3.1-flash-lite-preview
    .PARAMETER Temperature
        Sampling temperature (0.0-1.0) passed to summarization.
        Lower values produce more deterministic output.
        Default: 0.1
    .EXAMPLE
        Import-AITriadDocument -Url 'https://example.com/article' -Pov accelerationist, skeptic
    .EXAMPLE
        Import-AITriadDocument -Inbox
    .EXAMPLE
        Import-AITriadDocument -File 'path/to/file.pdf' -Pov skeptic
    .NOTES
        Set backend-specific env vars (GEMINI_API_KEY, ANTHROPIC_API_KEY,
        GROQ_API_KEY) or AI_API_KEY for metadata enrichment.
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
        [ValidateSet('accelerationist', 'safetyist', 'skeptic', 'cross-cutting', 'situations')]
        [string[]]$Pov = @(),

        [Parameter(ParameterSetName = 'ByUrl')]
        [Parameter(ParameterSetName = 'ByFile')]
        [string[]]$Topic = @(),

        [switch]$SkipWayback,

        [switch]$NoSummaryQueue,

        [switch]$SkipAiMeta,

        [switch]$NoSummarize,

        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [Alias('GeminiModel')]
        [string]$Model = 'gemini-3.1-flash-lite-preview',

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.1
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # -- Paths ----------------------------------------------------------------
    $SourcesDir = Get-SourcesDir
    $InboxDir   = Join-Path $SourcesDir '_inbox'

    # -- AI API key (read once; absence is non-fatal) -------------------------
    if     ($Model -match '^gemini') { $Backend = 'gemini' }
    elseif ($Model -match '^claude') { $Backend = 'claude' }
    elseif ($Model -match '^groq')   { $Backend = 'groq'   }
        elseif ($Model -match '^openai') { $Backend = 'openai' }
    else                             { $Backend = 'gemini'  }
    $AIApiKey  = Resolve-AIApiKey -ExplicitKey '' -Backend $Backend

    # =========================================================================
    # Inner function — called once per document
    # =========================================================================
    function Find-ExistingSource {
        param(
            [string]$Url,
            [string]$FilePath
        )
        $MetaFiles = @(Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse -Depth 1 -ErrorAction SilentlyContinue)
        foreach ($MF in $MetaFiles) {
            try {
                $Meta = Get-Content $MF.FullName -Raw | ConvertFrom-Json
            } catch { continue }

            if (-not [string]::IsNullOrWhiteSpace($Url) -and $Meta.document_url -eq $Url) {
                return $MF.Directory.Name
            }

            if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
                $FileName = [System.IO.Path]::GetFileName($FilePath)
                $RawDir = Join-Path $MF.Directory.FullName 'raw'
                if (Test-Path (Join-Path $RawDir $FileName)) {
                    return $MF.Directory.Name
                }
            }
        }
        return $null
    }

    function Invoke-IngestDocument {
        [CmdletBinding()]
        param(
            [string]  $SourceUrl   = '',
            [string]  $SourceFile  = '',
            [string[]]$PovTags     = @(),
            [string[]]$TopicTags   = @()
        )

        # -- Idempotency check -----------------------------------------------
        $ExistingDocId = Find-ExistingSource -Url $SourceUrl -FilePath $SourceFile
        if ($ExistingDocId) {
            $MatchType = if (-not [string]::IsNullOrWhiteSpace($SourceUrl)) { "URL '$SourceUrl'" } else { "file '$(Split-Path $SourceFile -Leaf)'" }
            Write-Warn "Duplicate detected: $MatchType already ingested as '$ExistingDocId' — skipping"
            return $ExistingDocId
        }

        $RawContent   = $null
        $MarkdownText = ''
        $Title        = ''
        $Authors      = @()
        $SourceType   = 'unknown'
        $RawExtension = ''
        $IsUrl        = -not [string]::IsNullOrWhiteSpace($SourceUrl)

        if ($IsUrl) {
            # -- URL ingestion ------------------------------------------------
            Write-Step "Fetching URL: $SourceUrl"
            $SourceType   = 'web_article'
            $RawExtension = '.html'

            try {
                $TempHtml   = [System.IO.Path]::GetTempFileName() + '.html'
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

            $Meta    = Get-HtmlMeta -Html $HtmlContent
            if ($Meta.Title) { $Title = $Meta.Title } else { $Title = $SourceUrl }
            $Authors = $Meta.Author

            $MarkdownText = ConvertFrom-Html -Html $HtmlContent -SourceUrl $SourceUrl
            $RawContent   = $HtmlContent

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
            # -- Local file ingestion -----------------------------------------
            $ResolvedFile = Resolve-Path $SourceFile
            $Ext = [System.IO.Path]::GetExtension($ResolvedFile).ToLower()
            $RawExtension = $Ext

            Write-Step "Ingesting file: $ResolvedFile"
            $RawContent = [System.IO.File]::ReadAllBytes($ResolvedFile)

            switch ($Ext) {
                '.pdf' {
                    $SourceType   = 'pdf'
                    $MarkdownText = ConvertFrom-Pdf -PdfPath $ResolvedFile
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
                    if ($Meta.Title) { $Title = $Meta.Title } else {
                        $Title = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) }
                    $Authors      = $Meta.Author
                    # Prefer markitdown for HTML (better semantic extraction)
                    $MidMd = ConvertFrom-MarkItDown -FilePath $ResolvedFile
                    if ($MidMd) { $MarkdownText = $MidMd } else { $MarkdownText = ConvertFrom-Html -Html $HtmlContent }
                }
                { $_ -in '.pptx', '.ppt' } {
                    $SourceType   = 'presentation'
                    $MarkdownText = ConvertFrom-Office -FilePath $ResolvedFile
                    $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
                }
                { $_ -in '.xlsx', '.xls', '.csv' } {
                    $SourceType   = 'spreadsheet'
                    $MarkdownText = ConvertFrom-Office -FilePath $ResolvedFile
                    $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
                }
                { $_ -in '.epub' } {
                    $SourceType   = 'ebook'
                    $MarkdownText = ConvertFrom-Office -FilePath $ResolvedFile
                    $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
                }
                { $_ -in '.md', '.txt' } {
                    if ($Ext -eq '.md') { $SourceType = 'markdown' } else { $SourceType = 'plaintext' }
                    $MarkdownText = [System.IO.File]::ReadAllText($ResolvedFile)
                    $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
                    $H1Match = [regex]::Match($MarkdownText, '(?m)^#\s+(.+)$')
                    if ($H1Match.Success) { $Title = $H1Match.Groups[1].Value.Trim() }
                }
                Default {
                    # Try markitdown as a last-resort universal converter
                    $MidMd = ConvertFrom-MarkItDown -FilePath $ResolvedFile
                    if ($MidMd) {
                        $SourceType   = 'document'
                        $MarkdownText = $MidMd
                        $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile) -replace '[-_]', ' '
                    } else {
                        Write-Warn "Unsupported file type '$Ext' — storing raw, no Markdown conversion"
                        $SourceType   = 'unknown'
                        $MarkdownText = "# $(Split-Path $ResolvedFile -Leaf)`n`n[Binary file — no text extraction available]"
                        $Title        = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedFile)
                    }
                }
            }

            Write-OK "Read $($RawContent.Length) bytes from file"
        }

        # -- Gemini metadata enrichment ---------------------------------------
        $AiMeta = $null

        if (-not $SkipAiMeta -and -not [string]::IsNullOrWhiteSpace($AIApiKey)) {
            try {
                $AiMeta = Get-AIMetadata `
                    -MarkdownText  $MarkdownText `
                    -SourceUrl     $SourceUrl `
                    -FallbackTitle $Title `
                    -Model         $Model `
                    -ApiKey        $AIApiKey
            } catch {
                Write-Warn "AI enrichment threw an exception — continuing with heuristics: $_"
                $AiMeta = $null
            }
        } elseif ($SkipAiMeta) {
            Write-Info "Skipping AI enrichment (-SkipAiMeta)"
        } else {
            Write-Warn "No API key found — metadata enrichment skipped. Set backend env var or AI_API_KEY."
        }

        # Merge AI results with heuristic values and user-supplied flags
        if ($null -ne $AiMeta) {
            if (-not [string]::IsNullOrWhiteSpace($AiMeta.title)) { $Title = $AiMeta.title }
            $AiAuthors = @($AiMeta.authors | Where-Object { $_ })
            if ($AiAuthors.Count -gt 0) { $Authors = $AiAuthors }

            $AiPovTags = @($AiMeta.pov_tags | Where-Object { $_ })
            if ($PovTags.Count -eq 0 -and $AiPovTags.Count -gt 0) {
                $PovTags = $AiPovTags
                Write-Info "POV tags from AI: $($PovTags -join ', ')"
            } elseif ($PovTags.Count -gt 0) {
                Write-Info "POV tags from -Pov flag (AI suggestion ignored): $($PovTags -join ', ')"
            }

            $MergedTopics = @($TopicTags) + @($AiMeta.topic_tags) |
                Select-Object -Unique |
                Where-Object { $_ }
            $TopicTags = $MergedTopics
            if ($TopicTags.Count -gt 0) {
                Write-Info "Topic tags (merged): $($TopicTags -join ', ')"
            }
        }

        # -- Generate doc-id --------------------------------------------------
        $SlugSource = $Title
        if ([string]::IsNullOrWhiteSpace($SlugSource)) {
            if ($IsUrl) { $SlugSource = $SourceUrl } else { $SlugSource = [System.IO.Path]::GetFileNameWithoutExtension($SourceFile) }
        }
        $BaseSlug = New-Slug -Text $SlugSource
        $DocId    = Resolve-DocId -BaseSlug $BaseSlug

        Write-OK "Doc ID: $DocId"

        # -- Create directory structure ---------------------------------------
        $DocDir = Join-Path $SourcesDir $DocId
        $RawDir = Join-Path $DocDir 'raw'
        New-Item -ItemType Directory -Path $RawDir -Force | Out-Null
        Write-OK "Created: sources/$DocId/"

        # -- Save raw file ----------------------------------------------------
        if ($IsUrl) {
            $RawFilename = 'original' + $RawExtension
        } else {
            $RawFilename = [System.IO.Path]::GetFileName($SourceFile)
        }
        $RawPath = Join-Path $RawDir $RawFilename

        if ($RawContent -is [byte[]]) {
            # Use .NET directly — Set-Content -AsByteStream is PS 6+ only, and
            # WriteAllBytes is symmetric with the ReadAllBytes used to load it.
            [System.IO.File]::WriteAllBytes($RawPath, $RawContent)
        } else {
            Write-Utf8NoBom -Path $RawPath -Value $RawContent 
        }
        Write-OK "Raw file saved: raw/$RawFilename"

        # -- Normalize markdown (encoding artifacts, ligatures, etc.) ----------
        $MarkdownText = Normalize-Markdown -Text $MarkdownText

        # -- Add provenance header and write snapshot.md ----------------------
        $FinalMarkdown = Add-SnapshotHeader `
            -Markdown    $MarkdownText `
            -Title       $Title `
            -SourceUrl   $SourceUrl `
            -SourceType  $SourceType `
            -CapturedAt  (Get-Date -Format 'yyyy-MM-dd')

        $SnapshotPath = Join-Path $DocDir 'snapshot.md'
        Write-Utf8NoBom -Path $SnapshotPath -Value $FinalMarkdown 
        Write-OK "Snapshot written: snapshot.md ($([int]$FinalMarkdown.Length) chars)"

        # -- Write metadata.json ----------------------------------------------
        $Metadata = New-Metadata `
            -DocId       $DocId `
            -Title       $Title `
            -DocumentUrl $SourceUrl `
            -Author      $Authors `
            -SourceType  $SourceType `
            -PovTag      $PovTags `
            -TopicTag    $TopicTags

        if ($null -ne $AiMeta) {
            if ($AiMeta.date_published) {
                $Metadata['date_published'] = $AiMeta.date_published
                $Metadata['source_time']    = $AiMeta.date_published
            }
            if ($AiMeta.one_liner) { $Metadata['one_liner'] = $AiMeta.one_liner }
        }

        $MetaPath = Join-Path $DocDir 'metadata.json'
        $Metadata | ConvertTo-Json -Depth 5 | Write-Utf8NoBom -Path $MetaPath 
        Write-OK "Metadata written: metadata.json"

        # -- Summary queue ----------------------------------------------------
        if (-not $NoSummaryQueue) {
            Add-ToSummaryQueue -DocId $DocId
        }

        # -- Wayback Machine --------------------------------------------------
        if ($IsUrl -and -not $SkipWayback) {
            Submit-ToWaybackMachine -TargetUrl $SourceUrl
        }

        # -- Done -------------------------------------------------------------
        Write-Host ''
        Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host "  Ingested: $DocId" -ForegroundColor Green
        Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
        Write-Host "  sources/$DocId/" -ForegroundColor White
        Write-Host "    ├── raw/$RawFilename" -ForegroundColor Gray
        Write-Host "    ├── snapshot.md" -ForegroundColor Gray
        Write-Host "    └── metadata.json  (summary_status: pending)" -ForegroundColor Gray
        Write-Host ''

        return $DocId
    }

    # =========================================================================
    # Dispatch based on parameter set
    # =========================================================================
    switch ($PSCmdlet.ParameterSetName) {

        'ByUrl' {
            $DocId = Invoke-IngestDocument `
                -SourceUrl   $Url `
                -PovTags     $Pov `
                -TopicTags   $Topic

            if (-not $NoSummarize -and $DocId) {
                Write-Step "Running POV summarization for $DocId"
                Invoke-BatchSummary -DocId $DocId -Model $Model -Temperature $Temperature
            }
        }

        'ByFile' {
            $ResolvedFile = (Resolve-Path -LiteralPath $File).Path
            $ResolvedInbox = if (Test-Path $InboxDir) { (Resolve-Path -LiteralPath $InboxDir).Path } else { $null }
            $FromInbox = $ResolvedInbox -and $ResolvedFile.StartsWith($ResolvedInbox, [System.StringComparison]::OrdinalIgnoreCase)

            $DocId = Invoke-IngestDocument `
                -SourceFile  $ResolvedFile `
                -PovTags     $Pov `
                -TopicTags   $Topic

            $SummarizeOk = $true
            if (-not $NoSummarize -and $DocId) {
                Write-Step "Running POV summarization for $DocId"
                try {
                    Invoke-BatchSummary -DocId $DocId -Model $Model -Temperature $Temperature
                } catch {
                    $SummarizeOk = $false
                    Write-Fail "Summarization failed for $DocId`: $_"
                    if ($FromInbox) { Write-Info "File left in inbox for retry." }
                    throw
                }
            }

            # If the source lives under sources/_inbox/, clean it up after a fully
            # successful ingest+summarize — symmetrical with the -Inbox branch.
            if ($FromInbox -and $DocId -and $SummarizeOk) {
                $SidecarPath = $ResolvedFile + '.meta.json'
                if (Test-Path $ResolvedFile) { Remove-Item $ResolvedFile -Force }
                if (Test-Path $SidecarPath)  { Remove-Item $SidecarPath -Force }
                Write-OK "Removed inbox copy: $(Split-Path $ResolvedFile -Leaf)"
            }
        }

        'ByInbox' {
            if (-not (Test-Path $InboxDir)) {
                throw (New-ActionableError `
                    -Goal      'Process inbox documents' `
                    -Problem   "Inbox directory not found: $InboxDir" `
                    -Location  'Import-AITriadDocument -Inbox' `
                    -NextSteps @(
                        "Create the inbox directory: New-Item -ItemType Directory -Path '$InboxDir'"
                        'Drop files into sources/_inbox/ and re-run with -Inbox'
                    ))
            }

            $InboxFiles = @(Get-ChildItem -Path $InboxDir -File |
                Where-Object { $_.Name -ne '.gitkeep' })

            if ($InboxFiles.Count -eq 0) {
                Write-Warn "Inbox is empty: $InboxDir"
                Write-Info "Drop files into sources/_inbox/ and re-run with -Inbox"
                return
            }

            Write-Step "Processing $($InboxFiles.Count) file(s) from inbox"
            $IngestedIds = @()
            # Track inbox files for deferred cleanup — only remove after full pipeline succeeds
            $InboxCleanup = @{}  # DocId → @{ File = path; Sidecar = path }

            foreach ($InboxFile in $InboxFiles) {
                Write-Host ''
                Write-Host "  Processing: $($InboxFile.Name)" -ForegroundColor White
                Write-Host "  $('─' * 48)" -ForegroundColor DarkGray

                $SidecarPath = $InboxFile.FullName + '.meta.json'
                $SidecarPov  = @()
                $SidecarTopic= @()

                if (Test-Path $SidecarPath) {
                    try {
                        $Sidecar     = Get-Content $SidecarPath -Raw | ConvertFrom-Json
                        if ($Sidecar.pov_tags)   { $SidecarPov   = $Sidecar.pov_tags }   else { $SidecarPov   = @() }
                        if ($Sidecar.topic_tags) { $SidecarTopic = $Sidecar.topic_tags } else { $SidecarTopic = @() }
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
                    $InboxCleanup[$DocId] = @{
                        File    = $InboxFile.FullName
                        Sidecar = $SidecarPath
                    }

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
                foreach ($id in $IngestedIds) {
                    Write-Step "Running POV summarization for $id"
                    try {
                        Invoke-BatchSummary -DocId $id -Model $Model -Temperature $Temperature
                    } catch {
                        Write-Fail "Summarization failed for $id`: $_"
                        Write-Info "File left in inbox for retry."
                        $null = $InboxCleanup.Remove($id)
                    }
                }
            }

            # -- Remove inbox files only for fully successful documents ----------
            foreach ($entry in $InboxCleanup.GetEnumerator()) {
                $paths = $entry.Value
                if (Test-Path $paths.File) { Remove-Item $paths.File -Force }
                if (Test-Path $paths.Sidecar) { Remove-Item $paths.Sidecar -Force }
            }
        }
    }
}
