# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Protect-SensitiveText {
    <#
    .SYNOPSIS
        Redacts secret-looking tokens from text before it is logged.
    .DESCRIPTION
        AI API error bodies and exception messages can echo API keys, bearer
        tokens, or `key=` query parameters straight into warnings and logs.
        This replaces known secret shapes — and any explicitly-supplied literal
        secret values — with [REDACTED], then caps the length, so diagnostics
        never leak credentials.
    .PARAMETER Text
        The text to scrub. Null/empty is returned unchanged.
    .PARAMETER Secret
        Zero or more literal secret values to redact wherever they appear
        (e.g. the resolved API key in scope at the call site).
    .PARAMETER MaxLength
        Cap the returned length (default 1000). 0 disables the cap.
    .EXAMPLE
        Write-Warning "Response body: $(Protect-SensitiveText -Text $ErrBody -Secret $ResolvedKey)"
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0, ValueFromPipeline)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$Text,

        [string[]]$Secret = @(),

        [int]$MaxLength = 1000
    )

    process {
        if ([string]::IsNullOrEmpty($Text)) { return $Text }

        $out = $Text

        # 1) Explicit literal secrets first, longest-first so a shorter secret
        #    that is a substring of a longer one doesn't leave a partial behind.
        foreach ($s in (@($Secret) | Where-Object { $_ } | Sort-Object { $_.Length } -Descending)) {
            $out = $out.Replace($s, '[REDACTED]')
        }

        # 2) Known secret shapes. Token-shaped patterns run BEFORE the header
        #    key/value pattern: otherwise "Authorization: Bearer <tok>" has only
        #    "Bearer" eaten as the value, leaving the token behind.
        $patterns = @(
            '(?i)\bBearer\s+[A-Za-z0-9._\-]+'
            'AIza[0-9A-Za-z\-_]{20,}'        # Google API key
            'sk-[A-Za-z0-9\-_]{16,}'         # OpenAI / Anthropic style
            'gsk_[A-Za-z0-9]{16,}'           # Groq
            '(?i)\bkey=[^&\s"'']+'           # ?key= query parameter
            '(?i)(x-goog-api-key|api[_-]?key|authorization)["'']?\s*[:=]\s*["'']?[^\s"'',&}]+'
        )
        foreach ($p in $patterns) {
            $out = [regex]::Replace($out, $p, '[REDACTED]')
        }

        if ($MaxLength -gt 0 -and $out.Length -gt $MaxLength) {
            $out = $out.Substring(0, $MaxLength) + '…[truncated]'
        }

        return $out
    }
}
