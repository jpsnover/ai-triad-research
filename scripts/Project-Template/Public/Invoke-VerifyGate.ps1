function Invoke-VerifyGate {
    <#
    .SYNOPSIS
        Runs the project's verification gate (type check, lint, tests).
    .DESCRIPTION
        Auto-detects app directories containing package.json with a "verify" script,
        runs each one, and aggregates results. Also runs Pester tests if a tests/
        directory exists. Returns structured pass/fail results.
    .PARAMETER AppDir
        Specific app directory to verify. If not provided, auto-discovers all app
        directories with a "verify" npm script.
    .PARAMETER SkipPester
        Skip PowerShell Pester tests.
    .PARAMETER SkipNpm
        Skip npm-based verification.
    .EXAMPLE
        Invoke-VerifyGate
    .EXAMPLE
        Invoke-VerifyGate -AppDir ./taxonomy-editor
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$AppDir,

        [switch]$SkipPester,
        [switch]$SkipNpm
    )

    Set-StrictMode -Version Latest

    $results = [System.Collections.Generic.List[object]]::new()

    # npm verify gates
    if (-not $SkipNpm) {
        $appDirs = @()
        if ($AppDir) {
            $appDirs = @($AppDir)
        } else {
            $appDirs = Get-ChildItem -Path $script:RepoRoot -Filter 'package.json' -Depth 2 |
                Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
                ForEach-Object {
                    $pkg = Get-Content $_.FullName -Raw | ConvertFrom-Json
                    if ($pkg.PSObject.Properties['scripts'] -and $pkg.scripts.PSObject.Properties['verify']) {
                        $_.DirectoryName
                    }
                } |
                Where-Object { $_ }
        }

        foreach ($dir in $appDirs) {
            $dirName = Split-Path $dir -Leaf
            Write-Output "--- Verify: $dirName ---"

            $startTime = Get-Date
            $output = ''
            $exitCode = 0

            try {
                $output = & npm run verify --prefix $dir 2>&1 | Out-String
                $exitCode = $LASTEXITCODE
            }
            catch {
                $output = $_.Exception.Message
                $exitCode = 1
            }

            $elapsed = (Get-Date) - $startTime

            $results.Add([PSCustomObject]@{
                Gate     = "npm verify ($dirName)"
                Pass     = $exitCode -eq 0
                Duration = [math]::Round($elapsed.TotalSeconds, 1)
                Output   = $output.Trim()
            })

            if ($exitCode -eq 0) { Write-Output "  PASS ($([math]::Round($elapsed.TotalSeconds, 1))s)" }
            else { Write-Warning "  FAIL (exit $exitCode, $([math]::Round($elapsed.TotalSeconds, 1))s)" }
        }
    }

    # Pester tests
    if (-not $SkipPester) {
        $testsDir = Join-Path $script:RepoRoot 'tests'
        if (Test-Path $testsDir) {
            $testFiles = Get-ChildItem -Path $testsDir -Filter '*.Tests.ps1' -Recurse
            if ($testFiles.Count -gt 0) {
                Write-Output "--- Verify: Pester ($($testFiles.Count) test files) ---"

                $startTime = Get-Date
                try {
                    $pesterResult = Invoke-Pester -Path $testsDir -PassThru -Output Minimal
                    $pass = $pesterResult.FailedCount -eq 0
                }
                catch {
                    $pass = $false
                    $pesterResult = $null
                }

                $elapsed = (Get-Date) - $startTime

                $results.Add([PSCustomObject]@{
                    Gate     = 'Pester'
                    Pass     = $pass
                    Duration = [math]::Round($elapsed.TotalSeconds, 1)
                    Output   = if ($pesterResult) {
                                   "Passed: $($pesterResult.PassedCount), Failed: $($pesterResult.FailedCount), Skipped: $($pesterResult.SkippedCount)"
                               } else { 'Pester invocation failed' }
                })

                if ($pass) { Write-Output "  PASS ($([math]::Round($elapsed.TotalSeconds, 1))s)" }
                else { Write-Warning "  FAIL ($([math]::Round($elapsed.TotalSeconds, 1))s)" }
            }
        }
    }

    $allPass = @($results | Where-Object { -not $_.Pass }).Count -eq 0

    Write-Output ""
    if ($allPass) { Write-Output "=== ALL GATES PASSED ===" }
    else { Write-Warning "=== VERIFICATION FAILED ===" }

    [PSCustomObject]@{
        AllPass  = $allPass
        Results  = @($results)
        GateCount = $results.Count
    }
}
