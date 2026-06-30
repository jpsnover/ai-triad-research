# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Test stub for the debate CLI used by tests/PsBoundaryFaults.Tests.ps1 (t/1163).
.DESCRIPTION
    Invoked by Invoke-AITDebate when $env:AITRIAD_DEBATE_CLI_OVERRIDE points here.
    Behavior is controlled by environment variables so each test can request a
    specific failure mode without writing its own stub.

    AITRIAD_STUB_MODE:
      'structured-stderr'  → write ActionableError JSON to stderr, exit 1 (AC#1 happy path)
      'unstructured-stderr'→ write plain stderr lines, exit 1 (regression fallback)
      'structured-stdout'  → write ActionableError JSON to stdout, exit 1 (defensive)
      'success'            → write a minimal success JSON to stdout, exit 0

    AITRIAD_STUB_ERROR_JSON (optional):
      Custom JSON line. Defaults to a canonical fixture.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'

$Mode = $env:AITRIAD_STUB_MODE
if ([string]::IsNullOrWhiteSpace($Mode)) { $Mode = 'structured-stderr' }

$DefaultJson = '{"goal":"Run debate to completion","problem":"Stub CLI invoked: AI backend rejected the request (401 unauthorized)","location":"lib/debate/cli.ts:42","next_steps":["Verify GEMINI_API_KEY is set","Run Register-AIBackend -Backend gemini","Re-run Invoke-AITDebate"]}'
$ErrJson = if ($env:AITRIAD_STUB_ERROR_JSON) { $env:AITRIAD_STUB_ERROR_JSON } else { $DefaultJson }

switch ($Mode) {
    'structured-stderr' {
        [Console]::Error.WriteLine('[debate-cli] [setup] preparing engine')
        [Console]::Error.WriteLine('[debate-cli] [api] calling backend')
        [Console]::Error.WriteLine($ErrJson)
        exit 1
    }
    'unstructured-stderr' {
        [Console]::Error.WriteLine('[debate-cli] [error] something went wrong (no structured error)')
        [Console]::Error.WriteLine('Stack trace: at someFunction (cli.ts:99)')
        exit 1
    }
    'structured-stdout' {
        [Console]::Out.WriteLine($ErrJson)
        exit 1
    }
    'success' {
        $success = '{"success":true,"stats":{"rounds":0,"entries":0,"apiCalls":0,"totalTimeMs":1,"claimsAccepted":0,"claimsRejected":0},"files":{"debate":"stub","transcript":"stub","diagnostics":"stub"}}'
        [Console]::Out.WriteLine($success)
        exit 0
    }
    default {
        [Console]::Error.WriteLine("Unknown AITRIAD_STUB_MODE: '$Mode'")
        exit 2
    }
}
