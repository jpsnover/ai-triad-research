# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Parse a JSON string, recovering the valid prefix if the response was truncated (t/3195).
.DESCRIPTION
    Structured-output responses on entity-dense nodes can hit the model's maxTokens and truncate
    mid-JSON (e.g. `Unterminated string` at `proposals[23].quote`), which fails a strict
    ConvertFrom-Json and — before this helper — dropped the ENTIRE node (0 proposals) instead of
    the parseable prefix. This tries a strict parse first; on failure it repairs via
    Repair-TruncatedJson (closes open structures / trims to the last clean boundary) and re-parses,
    so the leading complete proposals survive (the partial trailing one is later dropped by the
    per-proposal validator). Genuinely unrepairable text re-throws the ORIGINAL parse error so the
    caller's failure handling is unchanged.

    Fallback-Path Logging (docs/error-handling.md): emits a WARN when it takes the repair path, so
    a silently-truncated response is visible rather than an invisible partial extraction.
.PARAMETER Text
    The raw JSON text (already fence-stripped/trimmed by the caller).
.PARAMETER Context
    Optional label (e.g. the node id) included in the repair WARN for attribution.
.OUTPUTS
    The parsed object. Throws the original ConvertFrom-Json error when even repair cannot produce
    valid JSON.
#>
function ConvertFrom-TruncatableJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Text,
        [string]$Context = ''
    )

    try {
        return $Text | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        $origError = $_
        $repaired = Repair-TruncatedJson -Text $Text
        if ($null -eq $repaired) {
            throw $origError   # unrepairable — preserve the caller's existing failure path
        }
        # Re-parse the repaired string; if THIS fails the repair didn't yield valid JSON, so the
        # text is genuinely broken — surface the original error, not a confusing secondary one.
        try {
            $parsed = $repaired | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw $origError
        }
        $label = if ($Context) { "$Context : " } else { '' }
        Write-Warning "ConvertFrom-TruncatableJson: ${label}response JSON was truncated ($($origError.Exception.Message)) — recovered the valid prefix via Repair-TruncatedJson; trailing partial item(s) dropped."
        return $parsed
    }
}
