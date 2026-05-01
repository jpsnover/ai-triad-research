# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-AICostReport {
    <#
    .SYNOPSIS
        Aggregates API usage telemetry and computes estimated costs.
    .DESCRIPTION
        Reads usage-summary.jsonl files from debate runs and/or pipeline
        telemetry, applies per-model pricing from ai-models.json, and
        produces a cost breakdown by model, session, and date.
    .PARAMETER Path
        Path to a usage-summary.jsonl file or directory containing them.
        Default: debates/ under the data root.
    .PARAMETER After
        Include only API calls after this date.
    .PARAMETER Before
        Include only API calls before this date.
    .PARAMETER Backend
        Filter to specific backends (gemini, claude, groq, openai).
    .PARAMETER GroupBy
        Group results by: Model, Session, Date, Backend. Default: Model.
    .PARAMETER Budget
        Optional monthly budget in USD. Displays remaining budget and
        burn-rate projection.
    .PARAMETER PassThru
        Return structured objects instead of formatted console output.
    .EXAMPLE
        Get-AICostReport
    .EXAMPLE
        Get-AICostReport -GroupBy Session -After '2026-04-01'
    .EXAMPLE
        Get-AICostReport -Budget 50 -GroupBy Date
    #>
    [CmdletBinding()]
    param(
        [string]$Path = '',
        [datetime]$After,
        [datetime]$Before,
        [ValidateSet('gemini', 'claude', 'groq', 'openai')]
        [string[]]$Backend,
        [ValidateSet('Model', 'Session', 'Date', 'Backend')]
        [string]$GroupBy = 'Model',
        [double]$Budget = 0,
        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ── Load pricing from ai-models.json ─────────────────────────────────────
    $ModelsPath = Join-Path $script:RepoRoot 'ai-models.json'
    if (-not (Test-Path $ModelsPath)) {
        New-ActionableError -Goal 'load AI model pricing' `
            -Problem "ai-models.json not found at $ModelsPath" `
            -Location 'Get-AICostReport' `
            -NextSteps @('Ensure ai-models.json exists in the repo root') -Throw
    }

    $ModelsData = Get-Content -Raw -Path $ModelsPath | ConvertFrom-Json
    $Pricing = @{}
    if ($ModelsData.PSObject.Properties['pricing']) {
        foreach ($Prop in $ModelsData.pricing.PSObject.Properties) {
            if ($Prop.Name -eq '_comment') { continue }
            $Pricing[$Prop.Name] = $Prop.Value
        }
    }

    # Build model-id → backend lookup
    $ModelBackend = @{}
    if ($ModelsData.models) {
        foreach ($M in $ModelsData.models) {
            $ModelBackend[$M.id] = $M.backend
        }
    }

    # ── Discover usage files ─────────────────────────────────────────────────
    $UsageFiles = @()
    if ($Path -and (Test-Path $Path)) {
        if ((Get-Item $Path).PSIsContainer) {
            $UsageFiles = @(Get-ChildItem -Path $Path -Filter 'usage-summary.jsonl' -Recurse)
        }
        else {
            $UsageFiles = @(Get-Item $Path)
        }
    }
    else {
        # Search repo root first, then data root
        $SearchDirs = @(
            (Join-Path $script:RepoRoot 'debates')
        )
        try { $SearchDirs += Join-Path (Get-DataRoot) 'debates' } catch { }

        foreach ($Dir in $SearchDirs) {
            if (Test-Path $Dir) {
                $UsageFiles = @(Get-ChildItem -Path $Dir -Filter 'usage-summary.jsonl' -Recurse)
                if ($UsageFiles.Count -gt 0) { break }
            }
        }
    }

    if ($UsageFiles.Count -eq 0) {
        Write-Warning 'No usage-summary.jsonl files found.'
        return
    }

    # ── Parse all entries ────────────────────────────────────────────────────
    $Entries = [System.Collections.Generic.List[PSObject]]::new()

    foreach ($File in $UsageFiles) {
        $SessionName = $File.Directory.Name
        foreach ($Line in (Get-Content $File.FullName)) {
            if ([string]::IsNullOrWhiteSpace($Line)) { continue }
            try {
                $Entry = $Line | ConvertFrom-Json
                $Entry | Add-Member -NotePropertyName 'session' -NotePropertyValue $SessionName -Force -ErrorAction SilentlyContinue

                # Parse timestamp
                $Ts = $null
                if ($Entry.PSObject.Properties['ts']) {
                    try { $Ts = [datetime]::Parse($Entry.ts) } catch { }
                }

                # Apply filters
                if ($After -and $Ts -and $Ts -lt $After) { continue }
                if ($Before -and $Ts -and $Ts -ge $Before) { continue }
                if ($Backend -and $Entry.PSObject.Properties['backend'] -and $Entry.backend -notin $Backend) { continue }

                $Entry | Add-Member -NotePropertyName 'parsedTs' -NotePropertyValue $Ts -Force -ErrorAction SilentlyContinue
                $Entries.Add($Entry)
            }
            catch { }
        }
    }

    if ($Entries.Count -eq 0) {
        Write-Warning 'No matching usage entries found.'
        return
    }

    # ── Compute costs per entry ──────────────────────────────────────────────
    foreach ($E in $Entries) {
        $ModelId = if ($E.PSObject.Properties['model']) { $E.model } else { 'unknown' }
        $InputTok  = if ($E.PSObject.Properties['promptTokens']) { [long]$E.promptTokens } else { 0 }
        $OutputTok = if ($E.PSObject.Properties['completionTokens']) { [long]$E.completionTokens } else { 0 }
        $CachedTok = if ($E.PSObject.Properties['cachedTokens']) { [long]$E.cachedTokens } else { 0 }

        $Cost = 0.0
        $PriceInfo = $null

        # Try exact model match, then with backend prefix
        if ($Pricing.ContainsKey($ModelId)) {
            $PriceInfo = $Pricing[$ModelId]
        }
        else {
            $EBackend = if ($E.PSObject.Properties['backend']) { $E.backend } else { '' }
            $PrefixedId = "$EBackend-$ModelId"
            if ($Pricing.ContainsKey($PrefixedId)) {
                $PriceInfo = $Pricing[$PrefixedId]
            }
        }

        if ($null -ne $PriceInfo) {
            $InputRate  = if ($PriceInfo.PSObject.Properties['inputPer1M'])  { $PriceInfo.inputPer1M }  else { 0 }
            $OutputRate = if ($PriceInfo.PSObject.Properties['outputPer1M']) { $PriceInfo.outputPer1M } else { 0 }
            $CachedRate = if ($PriceInfo.PSObject.Properties['cachedInputPer1M']) { $PriceInfo.cachedInputPer1M } else { $InputRate }

            $UncachedInput = [Math]::Max(0, $InputTok - $CachedTok)
            $Cost = ($UncachedInput * $InputRate / 1000000) + ($CachedTok * $CachedRate / 1000000) + ($OutputTok * $OutputRate / 1000000)
        }

        $E | Add-Member -NotePropertyName 'estimatedCost' -NotePropertyValue $Cost -Force
        $E | Add-Member -NotePropertyName 'hasPricing' -NotePropertyValue ($null -ne $PriceInfo) -Force
    }

    # ── Group and aggregate ──────────────────────────────────────────────────
    $GroupKey = switch ($GroupBy) {
        'Model'   { { param($e) if ($e.PSObject.Properties['model']) { $e.model } else { 'unknown' } } }
        'Session' { { param($e) if ($e.PSObject.Properties['session']) { $e.session } else { 'unknown' } } }
        'Date'    { { param($e) if ($e.parsedTs) { $e.parsedTs.ToString('yyyy-MM-dd') } else { 'unknown' } } }
        'Backend' { { param($e) if ($e.PSObject.Properties['backend']) { $e.backend } else { 'unknown' } } }
    }

    $Groups = @{}
    foreach ($E in $Entries) {
        $Key = & $GroupKey $E
        if (-not $Groups.ContainsKey($Key)) {
            $Groups[$Key] = [System.Collections.Generic.List[PSObject]]::new()
        }
        $Groups[$Key].Add($E)
    }

    $Aggregated = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($Key in ($Groups.Keys | Sort-Object)) {
        $Items = $Groups[$Key]
        $TotalInput    = ($Items | ForEach-Object { if ($_.PSObject.Properties['promptTokens']) { [long]$_.promptTokens } else { 0 } } | Measure-Object -Sum).Sum
        $TotalOutput   = ($Items | ForEach-Object { if ($_.PSObject.Properties['completionTokens']) { [long]$_.completionTokens } else { 0 } } | Measure-Object -Sum).Sum
        $TotalCached   = ($Items | ForEach-Object { if ($_.PSObject.Properties['cachedTokens']) { [long]$_.cachedTokens } else { 0 } } | Measure-Object -Sum).Sum
        $TotalCost     = ($Items | ForEach-Object { $_.estimatedCost } | Measure-Object -Sum).Sum
        $TotalLatency  = ($Items | ForEach-Object { if ($_.PSObject.Properties['latencyMs']) { [long]$_.latencyMs } else { 0 } } | Measure-Object -Sum).Sum
        $AvgLatency    = if ($Items.Count -gt 0) { [int]($TotalLatency / $Items.Count) } else { 0 }

        $CacheSavings = 0.0
        if ($TotalCached -gt 0) {
            $SampleEntry = $Items | Where-Object { $_.hasPricing } | Select-Object -First 1
            if ($SampleEntry) {
                $SModelId = if ($SampleEntry.PSObject.Properties['model']) { $SampleEntry.model } else { '' }
                $SPricing = $null
                if ($Pricing.ContainsKey($SModelId)) { $SPricing = $Pricing[$SModelId] }
                if ($SPricing) {
                    $FullRate   = if ($SPricing.PSObject.Properties['inputPer1M']) { $SPricing.inputPer1M } else { 0 }
                    $CachedRate = if ($SPricing.PSObject.Properties['cachedInputPer1M']) { $SPricing.cachedInputPer1M } else { $FullRate }
                    $CacheSavings = $TotalCached * ($FullRate - $CachedRate) / 1000000
                }
            }
        }

        $Aggregated.Add([PSCustomObject]@{
            Group         = $Key
            Calls         = $Items.Count
            InputTokens   = $TotalInput
            OutputTokens  = $TotalOutput
            CachedTokens  = $TotalCached
            TotalTokens   = $TotalInput + $TotalOutput
            EstimatedCost = [Math]::Round($TotalCost, 4)
            CacheSavings  = [Math]::Round($CacheSavings, 4)
            AvgLatencyMs  = $AvgLatency
        })
    }

    # ── Grand totals ─────────────────────────────────────────────────────────
    $GrandCalls   = ($Aggregated | Measure-Object -Property Calls -Sum).Sum
    $GrandInput   = ($Aggregated | Measure-Object -Property InputTokens -Sum).Sum
    $GrandOutput  = ($Aggregated | Measure-Object -Property OutputTokens -Sum).Sum
    $GrandCached  = ($Aggregated | Measure-Object -Property CachedTokens -Sum).Sum
    $GrandCost    = ($Aggregated | Measure-Object -Property EstimatedCost -Sum).Sum
    $GrandSavings = ($Aggregated | Measure-Object -Property CacheSavings -Sum).Sum

    $Summary = [PSCustomObject]@{
        TotalCalls       = $GrandCalls
        TotalInputTokens = $GrandInput
        TotalOutputTokens = $GrandOutput
        TotalCachedTokens = $GrandCached
        TotalTokens      = $GrandInput + $GrandOutput
        EstimatedCost    = [Math]::Round($GrandCost, 4)
        CacheSavings     = [Math]::Round($GrandSavings, 4)
        Breakdown        = $Aggregated
        DateRange        = @{
            Earliest = ($Entries | Where-Object { $_.parsedTs } | Sort-Object parsedTs | Select-Object -First 1).parsedTs
            Latest   = ($Entries | Where-Object { $_.parsedTs } | Sort-Object parsedTs -Descending | Select-Object -First 1).parsedTs
        }
    }

    # ── Provider status: key validation + rate limits ──────────────────────
    $ProviderStatus = [System.Collections.Generic.List[PSObject]]::new()
    $Dashboards = @{
        gemini = 'https://aistudio.google.com/apikey'
        claude = 'https://console.anthropic.com/settings/billing'
        groq   = 'https://console.groq.com/settings/usage'
        openai = 'https://platform.openai.com/usage'
    }

    foreach ($Bk in @('gemini', 'claude', 'groq', 'openai')) {
        $Key = Resolve-AIApiKey -ExplicitKey '' -Backend $Bk
        $KeySrc = $null
        try { $KeySrc = $script:LastApiKeySource } catch { }
        if (-not $KeySrc) {
            $EnvNames = @{ gemini = 'GEMINI_API_KEY'; claude = 'ANTHROPIC_API_KEY'; groq = 'GROQ_API_KEY'; openai = 'OPENAI_API_KEY' }
            if (-not [string]::IsNullOrWhiteSpace($Key)) {
                $BkEnv = $EnvNames[$Bk]
                if ($BkEnv -and [System.Environment]::GetEnvironmentVariable($BkEnv)) { $KeySrc = "`$env:$BkEnv" }
                elseif ($env:AI_API_KEY) { $KeySrc = '$env:AI_API_KEY' }
                else { $KeySrc = 'configured' }
            }
        }
        $Status = [PSCustomObject]@{
            Backend      = $Bk
            KeyConfigured = -not [string]::IsNullOrWhiteSpace($Key)
            KeySource    = $KeySrc
            Valid        = $null
            RateLimit    = $null
            RateRemaining = $null
            RateReset    = $null
            Dashboard    = $Dashboards[$Bk]
        }

        if ($Status.KeyConfigured) {
            try {
                $ProbeResult = switch ($Bk) {
                    'gemini' {
                        $Url = "https://generativelanguage.googleapis.com/v1beta/models?key=$Key&pageSize=1"
                        $Resp = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
                        @{ Valid = $Resp.StatusCode -eq 200; Headers = $Resp.Headers }
                    }
                    'claude' {
                        $Resp = Invoke-WebRequest -Uri 'https://api.anthropic.com/v1/models' `
                            -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop `
                            -Headers @{ 'x-api-key' = $Key; 'anthropic-version' = '2023-06-01' }
                        $Hdrs = $Resp.Headers
                        $RL = if ($Hdrs['x-ratelimit-limit-requests']) { $Hdrs['x-ratelimit-limit-requests'] } else { $null }
                        $RR = if ($Hdrs['x-ratelimit-remaining-requests']) { $Hdrs['x-ratelimit-remaining-requests'] } else { $null }
                        $RS = if ($Hdrs['x-ratelimit-reset-requests']) { $Hdrs['x-ratelimit-reset-requests'] } else { $null }
                        @{ Valid = $Resp.StatusCode -eq 200; RateLimit = $RL; RateRemaining = $RR; RateReset = $RS }
                    }
                    'groq' {
                        $Resp = Invoke-WebRequest -Uri 'https://api.groq.com/openai/v1/models' `
                            -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop `
                            -Headers @{ 'Authorization' = "Bearer $Key" }
                        $Hdrs = $Resp.Headers
                        $RL = if ($Hdrs['x-ratelimit-limit-requests']) { $Hdrs['x-ratelimit-limit-requests'] } else { $null }
                        $RR = if ($Hdrs['x-ratelimit-remaining-requests']) { $Hdrs['x-ratelimit-remaining-requests'] } else { $null }
                        $RS = if ($Hdrs['x-ratelimit-reset-requests']) { $Hdrs['x-ratelimit-reset-requests'] } else { $null }
                        @{ Valid = $Resp.StatusCode -eq 200; RateLimit = $RL; RateRemaining = $RR; RateReset = $RS }
                    }
                    'openai' {
                        $Resp = Invoke-WebRequest -Uri 'https://api.openai.com/v1/models' `
                            -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop `
                            -Headers @{ 'Authorization' = "Bearer $Key" }
                        $Hdrs = $Resp.Headers
                        $RL = if ($Hdrs['x-ratelimit-limit-requests']) { $Hdrs['x-ratelimit-limit-requests'] } else { $null }
                        $RR = if ($Hdrs['x-ratelimit-remaining-requests']) { $Hdrs['x-ratelimit-remaining-requests'] } else { $null }
                        @{ Valid = $Resp.StatusCode -eq 200; RateLimit = $RL; RateRemaining = $RR }
                    }
                }
                $Status.Valid = $ProbeResult.Valid
                if ($ProbeResult.RateLimit)     { $Status.RateLimit = $ProbeResult.RateLimit }
                if ($ProbeResult.RateRemaining) { $Status.RateRemaining = $ProbeResult.RateRemaining }
                if ($ProbeResult.RateReset)     { $Status.RateReset = $ProbeResult.RateReset }
            }
            catch {
                $Status.Valid = $false
            }
        }
        $ProviderStatus.Add($Status)
    }

    $Summary | Add-Member -NotePropertyName 'Providers' -NotePropertyValue $ProviderStatus -Force

    if ($PassThru) { return $Summary }

    # ── Formatted console output ─────────────────────────────────────────────
    $EarlyDate = if ($Summary.DateRange.Earliest) { $Summary.DateRange.Earliest.ToString('yyyy-MM-dd') } else { '?' }
    $LateDate  = if ($Summary.DateRange.Latest)   { $Summary.DateRange.Latest.ToString('yyyy-MM-dd') } else { '?' }

    Write-Host ''
    Write-Host '  AI Cost Report' -ForegroundColor Cyan
    Write-Host "  Period: $EarlyDate to $LateDate  |  $($UsageFiles.Count) usage file(s)" -ForegroundColor DarkGray
    Write-Host ''

    # Table header
    $ColW = @{ Group = 32; Calls = 7; Input = 12; Output = 12; Cached = 12; Cost = 10; Savings = 10; Latency = 10 }
    $Header = '  {0}  {1}  {2}  {3}  {4}  {5}  {6}  {7}' -f `
        $GroupBy.PadRight($ColW.Group),
        'Calls'.PadLeft($ColW.Calls),
        'Input Tok'.PadLeft($ColW.Input),
        'Output Tok'.PadLeft($ColW.Output),
        'Cached Tok'.PadLeft($ColW.Cached),
        'Cost'.PadLeft($ColW.Cost),
        'Savings'.PadLeft($ColW.Savings),
        'Avg ms'.PadLeft($ColW.Latency)

    Write-Host $Header -ForegroundColor DarkYellow
    Write-Host ('  ' + ('-' * ($Header.Length - 2))) -ForegroundColor DarkGray

    foreach ($Row in ($Aggregated | Sort-Object EstimatedCost -Descending)) {
        $CostStr    = '$' + $Row.EstimatedCost.ToString('F4')
        $SavingsStr = if ($Row.CacheSavings -gt 0) { '$' + $Row.CacheSavings.ToString('F4') } else { '-' }
        $Line = '  {0}  {1}  {2}  {3}  {4}  {5}  {6}  {7}' -f `
            $Row.Group.PadRight($ColW.Group).Substring(0, $ColW.Group),
            $Row.Calls.ToString('N0').PadLeft($ColW.Calls),
            $Row.InputTokens.ToString('N0').PadLeft($ColW.Input),
            $Row.OutputTokens.ToString('N0').PadLeft($ColW.Output),
            $Row.CachedTokens.ToString('N0').PadLeft($ColW.Cached),
            $CostStr.PadLeft($ColW.Cost),
            $SavingsStr.PadLeft($ColW.Savings),
            $Row.AvgLatencyMs.ToString('N0').PadLeft($ColW.Latency)
        Write-Host $Line
    }

    Write-Host ('  ' + ('-' * ($Header.Length - 2))) -ForegroundColor DarkGray

    # Totals row
    $TotalCostStr    = '$' + $Summary.EstimatedCost.ToString('F4')
    $TotalSavingsStr = if ($Summary.CacheSavings -gt 0) { '$' + $Summary.CacheSavings.ToString('F4') } else { '-' }
    $TotalsLine = '  {0}  {1}  {2}  {3}  {4}  {5}  {6}  {7}' -f `
        'TOTAL'.PadRight($ColW.Group),
        $Summary.TotalCalls.ToString('N0').PadLeft($ColW.Calls),
        $Summary.TotalInputTokens.ToString('N0').PadLeft($ColW.Input),
        $Summary.TotalOutputTokens.ToString('N0').PadLeft($ColW.Output),
        $Summary.TotalCachedTokens.ToString('N0').PadLeft($ColW.Cached),
        $TotalCostStr.PadLeft($ColW.Cost),
        $TotalSavingsStr.PadLeft($ColW.Savings),
        ''.PadLeft($ColW.Latency)
    Write-Host $TotalsLine -ForegroundColor White

    # Token efficiency
    $CacheHitRate = if ($GrandInput -gt 0) { [Math]::Round($GrandCached / $GrandInput * 100, 1) } else { 0 }
    $CostPerCall  = if ($GrandCalls -gt 0) { [Math]::Round($GrandCost / $GrandCalls, 4) } else { 0 }
    Write-Host ''
    Write-Host "  Cache hit rate: $CacheHitRate%  |  Avg cost/call: `$$($CostPerCall.ToString('F4'))  |  Total tokens: $($Summary.TotalTokens.ToString('N0'))" -ForegroundColor DarkGray

    # Budget tracking
    if ($Budget -gt 0) {
        $Remaining = $Budget - $GrandCost
        $DaysSpanned = 1
        if ($Summary.DateRange.Earliest -and $Summary.DateRange.Latest) {
            $Span = ($Summary.DateRange.Latest - $Summary.DateRange.Earliest).TotalDays
            if ($Span -gt 0) { $DaysSpanned = $Span }
        }
        $DailyBurn = $GrandCost / $DaysSpanned
        $DaysRemaining = if ($DailyBurn -gt 0) { [int]($Remaining / $DailyBurn) } else { 999 }

        Write-Host ''
        if ($Remaining -gt 0) {
            Write-Host "  Budget: `$$($Budget.ToString('F2'))  |  Spent: `$$($GrandCost.ToString('F4'))  |  Remaining: `$$($Remaining.ToString('F4'))" -ForegroundColor Green
            Write-Host "  Daily burn rate: `$$($DailyBurn.ToString('F4'))/day  |  ~$DaysRemaining days at current rate" -ForegroundColor DarkGray
        }
        else {
            Write-Host "  Budget: `$$($Budget.ToString('F2'))  |  OVER BUDGET by `$$([Math]::Abs($Remaining).ToString('F4'))" -ForegroundColor Red
        }
    }

    # ── Provider status ─────────────────────────────────────────────────────
    Write-Host '  Provider Status' -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 80)) -ForegroundColor DarkGray

    foreach ($Prov in $ProviderStatus) {
        $BackendLabel = $Prov.Backend.PadRight(8)
        if (-not $Prov.KeyConfigured) {
            Write-Host "  $BackendLabel  No API key configured" -ForegroundColor DarkGray
        }
        elseif ($Prov.Valid) {
            $StatusLine = "  $BackendLabel  Key: valid ($($Prov.KeySource))"
            if ($Prov.RateLimit) {
                $StatusLine += "  |  Rate: $($Prov.RateRemaining)/$($Prov.RateLimit) remaining"
                if ($Prov.RateReset) { $StatusLine += " (resets $($Prov.RateReset))" }
            }
            Write-Host $StatusLine -ForegroundColor Green
        }
        else {
            Write-Host "  $BackendLabel  Key: INVALID or expired ($($Prov.KeySource))" -ForegroundColor Red
        }
        Write-Host "             Billing: $($Prov.Dashboard)" -ForegroundColor DarkGray
    }

    Write-Host ''
}
