# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-StructuredErrorFromStderr {
    <#
    .SYNOPSIS
        Scan a stderr buffer for an ActionableError JSON line and return its fields.
    .DESCRIPTION
        The TypeScript debate engine (and other subprocesses) may emit a single-line
        JSON object on stderr that conforms to the ActionableError shape:

            {"goal":"...", "problem":"...", "location":"...", "next_steps":["...","..."]}

        This helper scans the buffer newest-line-first and returns a normalized
        PSCustomObject when it finds such a line. Returns $null when nothing matches,
        so callers can fall back to their existing generic error path.

        Required keys (all four must be present for the line to qualify):
          goal, problem, location, next_steps

        Lines that ConvertFrom-Json fails on are silently skipped (most stderr is
        plain text and would throw).
    .PARAMETER StderrLines
        The captured stderr buffer (array of strings, one per line). May be empty,
        null, or contain empty strings — the function handles all gracefully.
    .OUTPUTS
        PSCustomObject with Goal/Problem/Location/NextSteps (array) and RawLine on
        hit, $null on miss.
    .EXAMPLE
        $err = Get-StructuredErrorFromStderr -StderrLines $StdErr
        if ($err) { throw "[ActionableError] $($err.Goal): $($err.Problem)" }
    .EXAMPLE
        # Scan a captured subprocess stderr buffer
        $stderr = @('starting up', '{"goal":"G","problem":"P","location":"L","next_steps":["x"]}')
        Get-StructuredErrorFromStderr -StderrLines $stderr
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [AllowEmptyString()]
        [AllowNull()]
        [string[]]$StderrLines
    )

    Set-StrictMode -Version Latest

    # Scan newest line first — the structured error is typically the last
    # meaningful thing the engine writes before exiting.
    $reversed = @($StderrLines | Where-Object { $_ -and $_.Trim() })
    [Array]::Reverse($reversed)

    foreach ($line in $reversed) {
        $trimmed = $line.Trim()
        # Cheap pre-filter: must look like a single-line JSON object
        if (-not $trimmed.StartsWith('{') -or -not $trimmed.EndsWith('}')) { continue }

        try {
            $obj = $trimmed | ConvertFrom-Json -ErrorAction Stop
        } catch {
            # Not JSON — fall through to the next line
            continue
        }

        # Require all four ActionableError fields as a shape gate. PSObject.Properties
        # guarded per the project's strict-mode + ConvertFrom-Json convention.
        $hasGoal       = $obj.PSObject.Properties['goal']
        $hasProblem    = $obj.PSObject.Properties['problem']
        $hasLocation   = $obj.PSObject.Properties['location']
        $hasNextSteps  = $obj.PSObject.Properties['next_steps']
        if (-not ($hasGoal -and $hasProblem -and $hasLocation -and $hasNextSteps)) { continue }

        # Normalize next_steps to a string[] — TS may emit a single string or an array.
        $steps = @()
        if ($obj.next_steps -is [System.Collections.IEnumerable] -and -not ($obj.next_steps -is [string])) {
            foreach ($s in $obj.next_steps) { $steps += [string]$s }
        } else {
            $steps = @([string]$obj.next_steps)
        }

        return [PSCustomObject]@{
            Goal      = [string]$obj.goal
            Problem   = [string]$obj.problem
            Location  = [string]$obj.location
            NextSteps = $steps
            RawLine   = $trimmed
        }
    }

    return $null
}
