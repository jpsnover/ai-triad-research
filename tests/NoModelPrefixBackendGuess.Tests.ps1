# Tag: security (t/4087)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/4087 condition 5: no code guesses a model's backend from its id prefix.
.DESCRIPTION
    The copy-pasted `if ($Model -match '^gemini') ... else gemini` chain is how GEMINI_API_KEY reached
    other providers. The backend must come from ai-models.json (Get-AIModelBackend /
    Get-AIModelKeyStatus). This scans PowerShell sources for the guess forms and fails on any hit that
    isn't allowlisted below. Allowlist entries are exact (file + a fragment of the line) and each states
    why the line is not a key-routing guess.
#>

BeforeAll {
    $script:Root = Join-Path $PSScriptRoot '..'
    $Prefix = '(gemini|claude|groq|openai|azure|ollama|deepseek|zai|moonshot|xai)'
    $script:GuessPatterns = @(
        # `$Model -match '^gemini'` (any *Model variable, any registered prefix)
        "\`$\w*[Mm]odel\w*\s+-c?match\s+['""]\^$Prefix"
        # `switch -Wildcard ($Model) { 'claude*' ...`
        "switch\s+-(Wildcard|Regex)\s*\(\s*\`$\w*[Mm]odel"
        # a prefix table entry: @{ Pattern = '^gemini'; Backend = ... }
        "Pattern\s*=\s*['""]\^$Prefix"
        # the default arm of a guess: else { 'gemini' } / else { $Backend = 'groq' }
        "else\s*\{\s*(\`$\w+\s*=\s*)?['""]$Prefix['""]\s*\}"
        # a key resolved for a hardcoded backend: Resolve-AIApiKey ... -Backend 'gemini'
        "Resolve-AIApiKey\b.*-Backend\s+['""]$Prefix['""]"
    )

    # File (repo-relative, forward slashes) + a fragment that must appear on the line + why it's allowed.
    $script:Allowlist = @(
        @{ File = 'scripts/AIEnrich.psm1'; Fragment = 'switch -Wildcard ($Model)'
           Reason = 'Get-AIDefaultTimeoutSec: picks a TIMEOUT default, not a key or a backend to call; inside Invoke-AIApi, which is out of scope for t/4087 (moves to the registry with t/3910 #36 / t/4078).' }
        @{ File = 'scripts/AIEnrich.psm1'; Fragment = "Resolve-AIApiKey -ExplicitKey `$ApiKey -Backend 'gemini' }"
           Reason = "Measure-PromptTokens calls Gemini's countTokens endpoint, so a GEMINI key is the correct pairing; Resolve-AIApiKey's guard refuses a foreign explicit key." }
    )

    function Get-PrefixGuessHits {
        $Files = @(Get-ChildItem -Path (Join-Path $script:Root 'scripts' 'AITriad') -Recurse -File -Include '*.ps1', '*.psm1') +
                 @(Get-ChildItem -Path (Join-Path $script:Root 'scripts') -File -Filter '*.psm1')
        foreach ($F in $Files) {
            $Rel = [IO.Path]::GetRelativePath((Resolve-Path $script:Root), $F.FullName) -replace '\\', '/'
            $N = 0
            $InHelp = $false
            foreach ($Line in [IO.File]::ReadAllLines($F.FullName)) {
                $N++
                # Skip comment-based help blocks (<# ... #>): examples there are documentation.
                if ($InHelp) { if ($Line -match '#>') { $InHelp = $false }; continue }
                if ($Line -match '^\s*<#' -and $Line -notmatch '#>') { $InHelp = $true; continue }
                if ($Line -match '^\s*#') { continue }
                foreach ($P in $script:GuessPatterns) {
                    if ($Line -notmatch $P) { continue }
                    $Allowed = @($script:Allowlist | Where-Object { $_.File -eq $Rel -and $Line.Contains($_.Fragment) }).Count -gt 0
                    if (-not $Allowed) { "$Rel`:$N  $($Line.Trim())" }
                    break
                }
            }
        }
    }
}

Describe 'No model-prefix backend guessing in PowerShell sources (t/4087 condition 5)' -Tag 'security' {

    It 'finds no un-allowlisted prefix-guess pattern' {
        $Hits = @(Get-PrefixGuessHits)
        $Hits | Should -BeNullOrEmpty -Because "derive the backend with Get-AIModelBackend / Get-AIModelKeyStatus (ai-models.json), never from the model id prefix (t/4087). Hits:`n$($Hits -join "`n")"
    }

    It 'every allowlist entry still matches a real line (no stale exemptions)' {
        foreach ($E in $script:Allowlist) {
            $Path = Join-Path $script:Root $E.File
            Test-Path $Path | Should -BeTrue -Because "allowlisted file $($E.File) must exist"
            @([IO.File]::ReadAllLines($Path) | Where-Object { $_.Contains($E.Fragment) }).Count | Should -BeGreaterThan 0 -Because "stale allowlist entry: $($E.File) / $($E.Fragment)"
        }
    }

    It 'the detector catches the original pattern (self-test against a synthetic sample)' {
        $Sample = @(
            "        if     (`$Model -match '^gemini') { `$Backend = 'gemini' }"
            "        else                             { `$Backend = 'gemini'  }"
            "    @{ Pattern = '^claude'; Backend = 'claude' }"
            "    `$Backend = if (`$Model -match '^gemini') { 'gemini' } elseif (`$Model -match '^claude') { 'claude' } else { 'groq' }"
            "        `$ApiKey = Resolve-AIApiKey -ExplicitKey '' -Backend 'gemini'"
        )
        foreach ($Line in $Sample) {
            @($script:GuessPatterns | Where-Object { $Line -match $_ }).Count | Should -BeGreaterThan 0 -Because "the detector must flag: $Line"
        }
    }
}
