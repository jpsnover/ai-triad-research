function Test-FlightRecorderPII {
    <#
    .SYNOPSIS
        Scans a flight recorder dump for potential PII or secret leaks.
    .DESCRIPTION
        Reads a flight recorder NDJSON dump and checks every string value for
        patterns that indicate PII (email addresses) or secrets (API keys,
        Bearer tokens, JWTs). Returns findings with line numbers and context.

        Use this as a pre-release check or after adding new data fields to
        verify the redaction layer is working.
    .PARAMETER Path
        Path to the JSONL dump file.
    .EXAMPLE
        Test-FlightRecorderPII -Path ./flight-recorder-dump.jsonl
    .EXAMPLE
        Get-FlightRecorderDump -Last 1 | Test-FlightRecorderPII
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipelineByPropertyName)]
        [Alias('FullName')]
        [string]$Path
    )

    process {
        Set-StrictMode -Version Latest

        if (-not (Test-Path $Path)) {
            New-ActionableError `
                -Goal 'Scan flight recorder for PII' `
                -Problem "File not found: $Path" `
                -Location 'Test-FlightRecorderPII' `
                -NextSteps @('Verify the dump file path', 'Run Get-FlightRecorderDump to list dumps') -Throw
        }

        $patterns = @(
            @{ Name = 'API Key (Google)';    Regex = 'AIzaSy[A-Za-z0-9_-]{33}' }
            @{ Name = 'API Key (OpenAI)';    Regex = 'sk-[A-Za-z0-9]{20,}' }
            @{ Name = 'API Key (Groq)';      Regex = 'gsk_[A-Za-z0-9]{20,}' }
            @{ Name = 'API Key (xAI)';       Regex = 'xai-[A-Za-z0-9]{20,}' }
            @{ Name = 'GitHub Token';        Regex = '(ghp_|github_pat_)[A-Za-z0-9_]{20,}' }
            @{ Name = 'Bearer Token';        Regex = 'Bearer\s+[A-Za-z0-9\-._~+/]+=*' }
            @{ Name = 'Email Address';       Regex = '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' }
            @{ Name = 'JWT';                 Regex = 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.' }
            @{ Name = 'Private Key Block';   Regex = '-----BEGIN (RSA |EC )?PRIVATE KEY-----' }
            @{ Name = 'Connection String';   Regex = '(password|pwd)=[^;]{3,}' }
        )

        $findings = [System.Collections.Generic.List[object]]::new()
        $lineNum = 0

        foreach ($line in [System.IO.File]::ReadLines($Path)) {
            $lineNum++
            if (-not $line.Trim()) { continue }

            foreach ($pat in $patterns) {
                $regexHits = [regex]::Matches($line, $pat.Regex, 'IgnoreCase')
                foreach ($m in $regexHits) {
                    # Mask the match for safe display
                    $val = $m.Value
                    $masked = if ($val.Length -gt 12) {
                        $val.Substring(0, 6) + '...' + $val.Substring($val.Length - 4)
                    } else { $val.Substring(0, [Math]::Min(4, $val.Length)) + '...' }

                    $findings.Add([PSCustomObject]@{
                        Line     = $lineNum
                        Pattern  = $pat.Name
                        Match    = $masked
                        Position = $m.Index
                    })
                }
            }
        }

        if ($findings.Count -eq 0) {
            Write-Host "PASS: No PII or secret patterns found in $Path ($lineNum lines scanned)."
        } else {
            Write-Warning "FAIL: $($findings.Count) potential PII/secret leak(s) found in $Path"
            $findings | Format-Table -AutoSize | Out-Host
        }

        [PSCustomObject]@{
            Path     = $Path
            Lines    = $lineNum
            Pass     = $findings.Count -eq 0
            Findings = @($findings)
        }
    }
}
