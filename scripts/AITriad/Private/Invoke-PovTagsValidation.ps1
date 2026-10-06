# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-PovTagsValidation {
    <#
    .SYNOPSIS
        Shared blocking-gate check for every PS writer of `pov_tags` (t/3969 Set-PovNodeTags,
        t/3971 Invoke-ProposalApply — the shared-utility rule, TL t/3957#7 point D's same
        pattern applied here). Validates a batch of node/tags pairs against the registry via
        lib/schema/pov-tags-cli.ts, fail-closed on exit code and checked-count (TL t/3969#2
        cond B.3), before the caller writes anything.
    .DESCRIPTION
        Builds one CLI request for the WHOLE batch (one call, not one per node), fed via a
        GetTempFileName() input file (non-data; removed after the call). Throws
        New-ActionableError on: exit 1 (quoting the CLI's errors[]), any other non-zero exit
        ("could not run the check"), a missing result line, or `checked` != the number of
        entries submitted (the empty-result trap). Returns nothing on success.
    .PARAMETER Entries
        Array of @{ NodeId = <string>; Tags = <string[]> }. Empty is a no-op (nothing to
        validate, nothing written by this check).
    .PARAMETER Goal
        Caller-supplied Goal text for the ActionableError, so a MERGE/SPLIT validation
        failure reads differently from a Set-PovNodeTags one.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [hashtable[]]$Entries,

        [Parameter(Mandatory)]
        [string]$Goal
    )

    Set-StrictMode -Version Latest

    $fail = {
        param($problem, $steps)
        throw (New-ActionableError -Goal $Goal -Problem $problem -Location 'Invoke-PovTagsValidation' -NextSteps $steps -PassThru)
    }

    if (@($Entries).Count -eq 0) { return }

    # @() on the outer array AND -InputObject (never piped) on the encode: both guard the
    # one-element-array unroll hazard (t/3948-class).
    $request = @($Entries | ForEach-Object { @{ id = $_.NodeId; pov_tags = @($_.Tags) } })
    $requestJson = ConvertTo-Json -InputObject $request -Depth 10 -Compress

    # -WhatIf:$false throughout: this check is non-destructive and must run even when the
    # CALLER is invoked under -WhatIf (only the caller's eventual data write is WhatIf-gated).
    $Inv = Resolve-PovTagsCli
    $TmpIn = [System.IO.Path]::GetTempFileName()
    $StderrFile = [System.IO.Path]::GetTempFileName()
    try {
        Set-Content -LiteralPath $TmpIn -Value $requestJson -NoNewline -WhatIf:$false
        $AllArgs = @($Inv.ArgPrefix) + @('--input', $TmpIn)
        $Stdout = & $Inv.Exe @AllArgs 2> $StderrFile
        $Exit = $LASTEXITCODE
        $Stderr = if (Test-Path $StderrFile) { Get-Content -Raw -Path $StderrFile } else { '' }
    }
    finally {
        Remove-Item -Path $TmpIn, $StderrFile -Force -ErrorAction SilentlyContinue -WhatIf:$false
    }

    # The documented contract: stdout's LAST line is exactly one JSON object.
    $resultLine = @(@($Stdout) | Where-Object { $_ -match '^\s*\{' }) | Select-Object -Last 1

    if ($Exit -eq 1) {
        $errors = @()
        if ($resultLine) { try { $errors = @(($resultLine | ConvertFrom-Json).errors) } catch { } }
        & $fail "pov-tags-cli refused $(@($errors).Count) invalid entr$(if (@($errors).Count -eq 1) { 'y' } else { 'ies' }) — writing nothing" $errors
    }
    if ($Exit -ne 0) {
        & $fail "pov-tags-cli could not run the check (exit $Exit) — writing nothing: $($Stderr.Trim())" `
            @('Verify tsx and its runtime deps are installed (npm ci)', 'Check the CLI path Resolve-PovTagsCli resolved')
    }
    if (-not $resultLine) {
        & $fail 'pov-tags-cli exited 0 but produced no result line — treat as failure, not success (the empty-result trap)' `
            @('Report with the CLI stdout/stderr')
    }
    $checkResult = $resultLine | ConvertFrom-Json
    if ([int]$checkResult.checked -ne $Entries.Count) {
        & $fail "pov-tags-cli checked $($checkResult.checked) node(s) but $($Entries.Count) were submitted — writing nothing (the empty-result trap)" `
            @('This usually means the input was truncated or malformed', 'Report with the input and the CLI output')
    }
}
