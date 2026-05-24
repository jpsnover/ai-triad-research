# Validate all URLs in intellectualLineageInfo.ts
# Outputs a JSON report of broken URLs for batch fixing.

param(
    [int]$MaxConcurrent = 5,
    [int]$TimeoutSec = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$FilePath = Join-Path $PSScriptRoot '..' 'taxonomy-editor' 'src' 'renderer' 'data' 'intellectualLineageInfo.ts'
if (-not (Test-Path $FilePath)) { throw "File not found: $FilePath" }

$Content = Get-Content $FilePath -Raw

# Extract all URLs with their line numbers and labels
$Entries = [System.Collections.Generic.List[hashtable]]::new()
$Lines = Get-Content $FilePath
for ($i = 0; $i -lt $Lines.Count; $i++) {
    $Line = $Lines[$i]
    if ($Line -match 'url:\s*"(https?://[^"]+)"') {
        $Url = $Matches[1]
        # Try to extract label from same line
        $Label = ''
        if ($Line -match 'label:\s*"([^"]+)"') { $Label = $Matches[1] }
        $Entries.Add(@{ url = $Url; label = $Label; line = $i + 1 })
    }
}

Write-Host "Found $($Entries.Count) URLs to validate" -ForegroundColor Cyan
Write-Host ""

$Valid = [System.Collections.Concurrent.ConcurrentBag[hashtable]]::new()
$Broken = [System.Collections.Concurrent.ConcurrentBag[hashtable]]::new()
$Checked = [int]0

# Soft 404 patterns
$Soft404Patterns = '(?i)(page not found|does not exist|no article|404 error|there is no page|page you requested|not be found|no longer available)'

# Process in batches to avoid overwhelming network
$BatchSize = $MaxConcurrent
for ($bi = 0; $bi -lt $Entries.Count; $bi += $BatchSize) {
    $Batch = @($Entries[$bi..[Math]::Min($bi + $BatchSize - 1, $Entries.Count - 1)])

    $Jobs = $Batch | ForEach-Object {
        $Entry = $_
        Start-ThreadJob -ScriptBlock {
            param($Url, $Label, $LineNum, $Timeout, $Patterns)
            try {
                $Resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $Timeout `
                    -MaximumRedirection 5 -UseBasicParsing -ErrorAction Stop
                if ($Resp.StatusCode -ne 200) {
                    return @{ url = $Url; label = $Label; line = $LineNum; status = $Resp.StatusCode; reason = 'http_error' }
                }
                $Body = if ($Resp.Content.Length -gt 2048) { $Resp.Content.Substring(0, 2048) } else { $Resp.Content }
                if ($Body -match $Patterns) {
                    return @{ url = $Url; label = $Label; line = $LineNum; status = 200; reason = 'soft_404' }
                }
                return @{ url = $Url; label = $Label; line = $LineNum; status = 200; reason = 'ok' }
            } catch {
                return @{ url = $Url; label = $Label; line = $LineNum; status = 0; reason = $_.Exception.Message.Substring(0, [Math]::Min(100, $_.Exception.Message.Length)) }
            }
        } -ArgumentList $Entry.url, $Entry.label, $Entry.line, $TimeoutSec, $Soft404Patterns
    }

    $Results = $Jobs | Wait-Job | Receive-Job
    $Jobs | Remove-Job -Force

    foreach ($R in @($Results)) {
        if ($R.reason -eq 'ok') {
            $Valid.Add($R)
        } else {
            $Broken.Add($R)
        }
    }

    $Checked += $Batch.Count
    $Pct = [Math]::Round($Checked / $Entries.Count * 100)
    Write-Host "`r  Checked: $Checked / $($Entries.Count) ($Pct%) | Valid: $($Valid.Count) | Broken: $($Broken.Count)" -NoNewline
}

Write-Host ""
Write-Host ""
Write-Host "=== RESULTS ===" -ForegroundColor Cyan
Write-Host "  Total URLs:  $($Entries.Count)"
Write-Host "  Valid:       $($Valid.Count)" -ForegroundColor Green
Write-Host "  Broken:      $($Broken.Count)" -ForegroundColor $(if ($Broken.Count -gt 0) { 'Red' } else { 'Green' })

if ($Broken.Count -gt 0) {
    $BrokenList = @($Broken) | Sort-Object { $_.line }

    # Group by reason type
    $Soft404s = @($BrokenList | Where-Object { $_.reason -eq 'soft_404' })
    $HttpErrors = @($BrokenList | Where-Object { $_.reason -eq 'http_error' })
    $NetworkErrors = @($BrokenList | Where-Object { $_.reason -notin 'soft_404', 'http_error' })

    Write-Host ""
    Write-Host "  Soft 404s:      $($Soft404s.Count)"
    Write-Host "  HTTP errors:    $($HttpErrors.Count)"
    Write-Host "  Network errors: $($NetworkErrors.Count)"

    # Save report
    $ReportPath = Join-Path $PSScriptRoot 'lineage-url-report.json'
    @{
        timestamp   = (Get-Date -Format 'o')
        total       = $Entries.Count
        valid       = $Valid.Count
        broken      = $Broken.Count
        broken_urls = $BrokenList
    } | ConvertTo-Json -Depth 5 | Set-Content $ReportPath -Encoding UTF8
    Write-Host ""
    Write-Host "  Report saved: $ReportPath" -ForegroundColor Yellow

    # Show first 20 broken
    Write-Host ""
    Write-Host "  First 20 broken URLs:" -ForegroundColor Yellow
    $BrokenList | Select-Object -First 20 | ForEach-Object {
        Write-Host "    L$($_.line) [$($_.reason)] $($_.url)" -ForegroundColor DarkGray
    }
}
