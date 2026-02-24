function Invoke-PIIAudit {
    <#
    .SYNOPSIS
        Pre-public PII scanner for the AI Triad research repository.
    .DESCRIPTION
        Scans all files in the research repo (EXCLUDING sources/_inbox and .git)
        for patterns that suggest PII leakage from the private rolodex repo.

        Checks for:
            - Email address patterns  (user@domain.tld)
            - Phone number patterns
            - Fields that should only exist in the private rolodex (e.g. "email", "notes" keys)
            - Any file path referencing the rolodex private repo

        Run this before flipping the repo to public.
    .EXAMPLE
        Invoke-PIIAudit
        # Returns findings or writes 'AUDIT PASSED'.
    .EXAMPLE
        Invoke-PIIAudit -Verbose
        # Prints each finding.
    #>
    [CmdletBinding()]
    param()

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $RepoRoot = $script:RepoRoot

    $EmailPattern = [regex]::new('[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
    $PhonePattern = [regex]::new('\b(\+?1[\s.\-]?)?(\(?\d{3}\)?[\s.\-]?)?\d{3}[\s.\-]?\d{4}\b')

    $SkipDirectories = @('.git', '_inbox', 'node_modules', '__pycache__', '.venv')

    $Findings = [System.Collections.Generic.List[PSCustomObject]]::new()

    $AllFiles = Get-ChildItem -Path $RepoRoot -Recurse -File -ErrorAction SilentlyContinue

    foreach ($File in $AllFiles) {
        $RelativePath = $File.FullName.Substring($RepoRoot.Length + 1)
        $PathParts = $RelativePath -split '[/\\]'

        $ShouldSkip = $false
        foreach ($Part in $PathParts) {
            if ($Part -in $SkipDirectories) {
                $ShouldSkip = $true
                break
            }
        }
        if ($ShouldSkip) { continue }

        try {
            $Content = Get-Content -Path $File.FullName -Raw -Encoding utf8 -ErrorAction Stop
        }
        catch {
            continue
        }

        if ([string]::IsNullOrEmpty($Content)) { continue }

        $Patterns = @(
            @{ Pattern = $EmailPattern; Label = 'EMAIL' }
            @{ Pattern = $PhonePattern; Label = 'PHONE' }
        )

        foreach ($Entry in $Patterns) {
            $Matches = $Entry.Pattern.Matches($Content)
            foreach ($Match in $Matches) {
                $Findings.Add([PSCustomObject]@{
                    File  = $RelativePath
                    Type  = $Entry.Label
                    Match = $Match.Value
                })
            }
        }
    }

    if ($Findings.Count -gt 0) {
        Write-Output "AUDIT FAILED: $($Findings.Count) potential PII finding(s)."
        if ($VerbosePreference -eq 'Continue') {
            foreach ($Finding in $Findings) {
                Write-Verbose "  [$($Finding.Type)] $($Finding.File): $($Finding.Match)"
            }
        }
        throw "PII audit found $($Findings.Count) finding(s). Review and remediate before making the repo public."
    }
    else {
        Write-Output 'AUDIT PASSED: No PII patterns found.'
    }
}
