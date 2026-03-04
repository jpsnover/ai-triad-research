function ConvertTo-GeneralTaxonomy {
    <#
    .SYNOPSIS
        Create plain-English taxonomy files for a general audience.

    .DESCRIPTION
        Copies the 4 core taxonomy files from taxonomy/Origin/ to taxonomy/General/
        and rewrites every node's label and description into accessible language
        (11th-grade reading level) using an AI backend.

        Structural metadata (IDs, parent/child, cross-cutting refs, conflict IDs)
        is preserved exactly — only label, description, and (for cross-cutting)
        interpretations are rewritten.

    .PARAMETER Model
        AI model to use. Defaults to AI_MODEL env var, then "gemini-3.1-flash-lite-preview".

    .PARAMETER Temperature
        Sampling temperature (0.0-1.0). Default: 0.3 (higher than analytical
        scripts since this is creative rewriting).

    .PARAMETER ApiKey
        Explicit API key override. Resolved from environment if not provided.

    .PARAMETER DryRun
        Show the processing plan without making any API calls or writing files.

    .EXAMPLE
        ConvertTo-GeneralTaxonomy -DryRun
        # Show plan: 13 batches across 4 files

    .EXAMPLE
        ConvertTo-GeneralTaxonomy
        # Produce 4 simplified files in taxonomy/General/

    .EXAMPLE
        ConvertTo-GeneralTaxonomy -Model claude-sonnet-4-5 -Temperature 0.4
        # Use Claude Sonnet with slightly more creative temperature
    #>

    [CmdletBinding()]
    param(
        [ValidateSet(
            'gemini-3.1-flash-lite-preview',
            'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
            'claude-opus-4', 'claude-sonnet-4-5', 'claude-haiku-3.5',
            'groq-llama-3.3-70b', 'groq-llama-4-scout'
        )]
        [string]$Model = $(if ($env:AI_MODEL) { $env:AI_MODEL } else { 'gemini-3.1-flash-lite-preview' }),

        [ValidateRange(0.0, 1.0)]
        [double]$Temperature = 0.3,

        [string]$ApiKey = '',

        [switch]$DryRun
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Paths (use module-scoped $script:RepoRoot set by AITriad.psm1)
    # ─────────────────────────────────────────────────────────────────────────
    $RepoRoot   = $script:RepoRoot
    $OriginDir  = Join-Path $RepoRoot 'taxonomy' 'Origin'
    $GeneralDir = Join-Path $RepoRoot 'taxonomy' 'General'

    # ─────────────────────────────────────────────────────────────────────────
    # Console helpers
    # ─────────────────────────────────────────────────────────────────────────
    function Write-Step { param([string]$M) Write-Host "`n`u{25B6}  $M"   -ForegroundColor Cyan   }
    function Write-OK   { param([string]$M) Write-Host "   `u{2713}  $M" -ForegroundColor Green  }
    function Write-Warn { param([string]$M) Write-Host "   `u{26A0}  $M" -ForegroundColor Yellow }
    function Write-Fail { param([string]$M) Write-Host "   `u{2717}  $M" -ForegroundColor Red    }
    function Write-Info { param([string]$M) Write-Host "   `u{2192}  $M" -ForegroundColor Gray   }

    # ─────────────────────────────────────────────────────────────────────────
    # Files to process — POV label injected into prompt for context
    # ─────────────────────────────────────────────────────────────────────────
    $TargetFiles = [ordered]@{
        'accelerationist.json' = 'Accelerationist'
        'safetyist.json'       = 'Safetyist'
        'skeptic.json'         = 'Skeptic'
        'cross-cutting.json'   = 'Cross-Cutting'
    }

    $BatchSize = 10

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 0 — Validate environment
    # ─────────────────────────────────────────────────────────────────────────
    Write-Step "Validating environment"

    if (-not (Test-Path $OriginDir)) {
        Write-Fail "Origin directory not found: $OriginDir"
        return
    }

    # Resolve API key — derive backend from model name prefix
    $Backend = if     ($Model -match '^gemini') { 'gemini' }
               elseif ($Model -match '^claude') { 'claude' }
               elseif ($Model -match '^groq')   { 'groq'   }
               else                             { 'gemini'  }
    $ResolvedKey = Resolve-AIApiKey -ExplicitKey $ApiKey -Backend $Backend

    if (-not $DryRun -and [string]::IsNullOrWhiteSpace($ResolvedKey)) {
        $EnvHint = switch ($Backend) {
            'gemini' { 'GEMINI_API_KEY' }
            'claude' { 'ANTHROPIC_API_KEY' }
            'groq'   { 'GROQ_API_KEY' }
            default  { 'AI_API_KEY' }
        }
        Write-Fail "No API key found. Set $EnvHint or AI_API_KEY."
        return
    }

    # Verify all source files exist
    foreach ($FileName in $TargetFiles.Keys) {
        $SourcePath = Join-Path $OriginDir $FileName
        if (-not (Test-Path $SourcePath)) {
            Write-Fail "Source file missing: $SourcePath"
            return
        }
    }

    Write-OK "Repo root  : $RepoRoot"
    Write-OK "Origin dir : $OriginDir"
    Write-OK "General dir: $GeneralDir"
    Write-OK "Model      : $Model"
    Write-OK "Temperature: $Temperature"
    Write-OK "Batch size : $BatchSize"
    if ($DryRun) { Write-Warn "DRY RUN — no API calls, no file writes" }

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 1 — Ensure taxonomy/General/ exists
    # ─────────────────────────────────────────────────────────────────────────
    Write-Step "Preparing output directory"

    if (-not $DryRun) {
        if (-not (Test-Path $GeneralDir)) {
            New-Item -ItemType Directory -Path $GeneralDir -Force | Out-Null
            Write-OK "Created: $GeneralDir"
        } else {
            Write-OK "Exists: $GeneralDir"
        }
    }

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 2 — Copy files from Origin -> General and gather batch plan
    # ─────────────────────────────────────────────────────────────────────────
    Write-Step "Loading source files and planning batches"

    $FilePlan     = [System.Collections.Generic.List[hashtable]]::new()
    $TotalNodes   = 0
    $TotalBatches = 0

    foreach ($FileName in $TargetFiles.Keys) {
        $SourcePath = Join-Path $OriginDir $FileName
        $DestPath   = Join-Path $GeneralDir $FileName
        $PovLabel   = $TargetFiles[$FileName]

        try {
            $JsonRaw  = Get-Content -Path $SourcePath -Raw -Encoding UTF8
            $JsonData = $JsonRaw | ConvertFrom-Json -Depth 20
        } catch {
            Write-Fail "Cannot parse $FileName : $_"
            continue
        }

        $NodeCount  = $JsonData.nodes.Count
        $BatchCount = [Math]::Ceiling($NodeCount / $BatchSize)

        $FilePlan.Add(@{
            FileName   = $FileName
            SourcePath = $SourcePath
            DestPath   = $DestPath
            PovLabel   = $PovLabel
            JsonData   = $JsonData
            NodeCount  = $NodeCount
            BatchCount = $BatchCount
        })

        $TotalNodes   += $NodeCount
        $TotalBatches += $BatchCount

        Write-OK "$FileName : $NodeCount nodes, $BatchCount batches"
    }

    if ($FilePlan.Count -eq 0) {
        Write-Fail "No files could be loaded. Aborting."
        return
    }

    Write-Info "Total: $TotalNodes nodes across $TotalBatches batches in $($FilePlan.Count) files"

    # ─────────────────────────────────────────────────────────────────────────
    # DRY RUN — print plan and exit
    # ─────────────────────────────────────────────────────────────────────────
    if ($DryRun) {
        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN PLAN" -ForegroundColor Yellow
        Write-Host "$('─' * 72)" -ForegroundColor DarkGray

        Write-Host "`n  FILES TO PROCESS:" -ForegroundColor Cyan
        foreach ($Plan in $FilePlan) {
            Write-Host "    $($Plan.FileName)  [$($Plan.PovLabel)]" -ForegroundColor White
            Write-Host "      Nodes: $($Plan.NodeCount)  |  Batches: $($Plan.BatchCount)  |  Batch size: $BatchSize" -ForegroundColor Gray
        }

        Write-Host "`n  TOTALS:" -ForegroundColor Cyan
        Write-Host "    Files   : $($FilePlan.Count)" -ForegroundColor White
        Write-Host "    Nodes   : $TotalNodes" -ForegroundColor White
        Write-Host "    Batches : $TotalBatches API calls" -ForegroundColor White
        Write-Host "    Model   : $Model" -ForegroundColor White

        Write-Host "`n  OUTPUT: taxonomy/General/*.json" -ForegroundColor Gray

        Write-Host "`n$('─' * 72)" -ForegroundColor DarkGray
        Write-Host "  DRY RUN complete. No API calls made. No files written." -ForegroundColor Yellow
        Write-Host "$('─' * 72)`n" -ForegroundColor DarkGray
        return
    }

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 3 — Process each file
    # ─────────────────────────────────────────────────────────────────────────
    Write-Step "Simplifying taxonomy nodes via AI"

    $Stats = @{
        FilesProcessed  = 0
        FilesFailed     = 0
        NodesSimplified = 0
        NodesPreserved  = 0
        BatchesOK       = 0
        BatchesFailed   = 0
        TotalApiSecs    = 0
    }

    foreach ($Plan in $FilePlan) {
        $FileName  = $Plan.FileName
        $PovLabel  = $Plan.PovLabel
        $JsonData  = $Plan.JsonData
        $Nodes     = @($JsonData.nodes)
        $IsCrossCutting = ($FileName -eq 'cross-cutting.json')

        Write-Host "`n  ┌─ $FileName [$PovLabel]" -ForegroundColor White
        Write-Host "  │  $($Nodes.Count) nodes, $($Plan.BatchCount) batches" -ForegroundColor Gray

        $SimplifiedNodes = [hashtable]::new()
        $FileSuccess     = $true

        # ── Process batches ──────────────────────────────────────────────
        for ($i = 0; $i -lt $Nodes.Count; $i += $BatchSize) {
            $BatchEnd   = [Math]::Min($i + $BatchSize, $Nodes.Count)
            $BatchNodes = $Nodes[$i..($BatchEnd - 1)]
            $BatchNum   = [Math]::Floor($i / $BatchSize) + 1

            Write-Host "  │  Batch $BatchNum/$($Plan.BatchCount) (nodes $($i + 1)-$BatchEnd)" -ForegroundColor Gray

            # Build the node payload for the AI — only fields it needs
            $NodePayload = @()
            foreach ($Node in $BatchNodes) {
                if ($IsCrossCutting) {
                    $NodePayload += @{
                        id              = $Node.id
                        label           = $Node.label
                        description     = $Node.description
                        interpretations = $Node.interpretations
                    }
                } else {
                    $NodePayload += @{
                        id          = $Node.id
                        category    = $Node.category
                        label       = $Node.label
                        description = $Node.description
                    }
                }
            }

            $PayloadJson = $NodePayload | ConvertTo-Json -Depth 10

            # Build the prompt
            if ($IsCrossCutting) {
                $StaticPrompt = Get-Prompt -Name 'general-taxonomy-crosscutting'
            } else {
                $StaticPrompt = Get-Prompt -Name 'general-taxonomy-pov' -Replacements @{ POV_LABEL = $PovLabel }
            }

            $Prompt = @"
$StaticPrompt

INPUT NODES:
$PayloadJson
"@

            # Call the AI
            $StartTime = Get-Date

            $AIResult = Invoke-AIApi `
                -Prompt      $Prompt `
                -Model       $Model `
                -ApiKey      $ResolvedKey `
                -Temperature $Temperature `
                -MaxTokens   16384 `
                -JsonMode `
                -TimeoutSec  120 `
                -MaxRetries  3 `
                -RetryDelays @(5, 15, 45)

            $Elapsed = (Get-Date) - $StartTime
            $Stats.TotalApiSecs += [int]$Elapsed.TotalSeconds

            if ($null -eq $AIResult) {
                Write-Host "  │  `u{2717} Batch $BatchNum FAILED: API returned null. Preserving originals." -ForegroundColor Red
                $Stats.BatchesFailed++
                continue
            }

            Write-Host "  │  `u{2713} Response ($($AIResult.Backend)): $([int]$Elapsed.TotalSeconds)s" -ForegroundColor Green

            # Parse response
            $RawText   = $AIResult.Text
            $CleanText = $RawText -replace '(?s)^```json\s*', '' -replace '(?s)\s*```$', ''
            $CleanText = $CleanText.Trim()

            try {
                $AiNodes = $CleanText | ConvertFrom-Json -Depth 20
            } catch {
                # Dump raw response for debugging
                $DebugPath = Join-Path $GeneralDir "debug-${FileName}-batch${BatchNum}.txt"
                Set-Content -Path $DebugPath -Value $RawText -Encoding UTF8
                Write-Host "  │  `u{2717} Batch ${BatchNum}: Invalid JSON from AI. Raw saved: $DebugPath" -ForegroundColor Red
                $Stats.BatchesFailed++
                continue
            }

            # Force to array
            $AiNodes = @($AiNodes)

            # Validate node count and ID ordering
            if ($AiNodes.Count -ne $BatchNodes.Count) {
                Write-Host "  │  `u{2717} Batch ${BatchNum}: Expected $($BatchNodes.Count) nodes, got $($AiNodes.Count). Preserving originals." -ForegroundColor Red
                $Stats.BatchesFailed++
                continue
            }

            $IdMismatch = $false
            for ($j = 0; $j -lt $BatchNodes.Count; $j++) {
                if ($AiNodes[$j].id -ne $BatchNodes[$j].id) {
                    Write-Host "  │  `u{2717} Batch ${BatchNum}: ID mismatch at index $j (expected '$($BatchNodes[$j].id)', got '$($AiNodes[$j].id)'). Preserving originals." -ForegroundColor Red
                    $IdMismatch = $true
                    break
                }
            }
            if ($IdMismatch) {
                $Stats.BatchesFailed++
                continue
            }

            # Store simplified nodes keyed by ID
            foreach ($AiNode in $AiNodes) {
                $SimplifiedNodes[$AiNode.id] = $AiNode
            }

            $Stats.BatchesOK++
            $Stats.NodesSimplified += $AiNodes.Count
        }

        # ── Defensive merge: graft AI text onto original structure ────────
        Write-Host "  │  Merging results..." -ForegroundColor Gray

        $MergedNodes = [System.Collections.Generic.List[object]]::new()

        foreach ($OrigNode in $Nodes) {
            # Start with a deep copy of the original via JSON round-trip
            $Merged = $OrigNode | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20

            if ($SimplifiedNodes.ContainsKey($OrigNode.id)) {
                $AiNode = $SimplifiedNodes[$OrigNode.id]

                # Overwrite only text fields
                $Merged.label       = $AiNode.label
                $Merged.description = $AiNode.description

                # For cross-cutting: also overwrite interpretations
                if ($IsCrossCutting -and $null -ne $AiNode.interpretations) {
                    $Interps = $AiNode.interpretations
                    if ($null -ne $Interps.accelerationist) {
                        $Merged.interpretations.accelerationist = $Interps.accelerationist
                    }
                    if ($null -ne $Interps.safetyist) {
                        $Merged.interpretations.safetyist = $Interps.safetyist
                    }
                    if ($null -ne $Interps.skeptic) {
                        $Merged.interpretations.skeptic = $Interps.skeptic
                    }
                }
            } else {
                $Stats.NodesPreserved++
            }

            $MergedNodes.Add($Merged)
        }

        # ── Write output file ────────────────────────────────────────────
        $JsonData.nodes = @($MergedNodes)

        # Copy source to General first, then overwrite with merged data
        $OutputJson = $JsonData | ConvertTo-Json -Depth 20
        Set-Content -Path $Plan.DestPath -Value $OutputJson -Encoding UTF8

        Write-Host "  └─ `u{2713} Written: $($Plan.DestPath)" -ForegroundColor Green
        $Stats.FilesProcessed++
    }

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 4 — Final report
    # ─────────────────────────────────────────────────────────────────────────
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  GENERAL TAXONOMY CONVERSION  |  model: $Model" -ForegroundColor White
    Write-Host "$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  Files processed : $($Stats.FilesProcessed) / $($FilePlan.Count)" -ForegroundColor $(if ($Stats.FilesFailed -eq 0) { 'Green' } else { 'Yellow' })
    Write-Host "  Nodes simplified: $($Stats.NodesSimplified)" -ForegroundColor White
    Write-Host "  Nodes preserved : $($Stats.NodesPreserved) (original text kept)" -ForegroundColor $(if ($Stats.NodesPreserved -eq 0) { 'Gray' } else { 'Yellow' })
    Write-Host "  Batches OK      : $($Stats.BatchesOK) / $TotalBatches" -ForegroundColor White
    Write-Host "  Batches failed  : $($Stats.BatchesFailed)" -ForegroundColor $(if ($Stats.BatchesFailed -eq 0) { 'Gray' } else { 'Red' })
    Write-Host "  Total API time  : $($Stats.TotalApiSecs)s" -ForegroundColor Gray

    if ($Stats.NodesPreserved -gt 0) {
        Write-Host "`n  NOTE: $($Stats.NodesPreserved) nodes kept original text due to batch failures." -ForegroundColor Yellow
        Write-Host "  Re-run ConvertTo-GeneralTaxonomy to retry those nodes." -ForegroundColor Yellow
    }

    Write-Host "`n  Output: taxonomy/General/*.json"
    Write-Host "$('═' * 72)`n" -ForegroundColor Cyan
}
