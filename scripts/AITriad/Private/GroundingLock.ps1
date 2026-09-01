# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Advisory cross-tool grounding write-lock for entity_mentions.json (t/3203).
.DESCRIPTION
    entity_mentions.json is a SHARED read-merge-write: CL's reconcile_grounding.py owns node:*
    and Update-EntityMentionIndex owns {sei:*, summary:*}. Once G8's inline hook / scheduled sweep
    can run them concurrently, an unguarded overlap lost-updates the other writer. Both tools honor
    the SAME advisory lockfile with matching semantics (TL contract t/3163#1; Python side landed
    t/3194, reconcile_grounding.py grounding_lock()):

      - Lockfile: `entity_mentions.lock` beside entity_mentions.json (same dir).
      - Acquire: atomic exclusive create — [IO.File]::Open(..., CreateNew, ...) is the .NET
        equivalent of the Python side's os.open(O_CREAT|O_EXCL); it throws when the file exists.
      - Staleness: a holder whose mtime age exceeds LOCK_STALE_SEC (120s, matching Python) is
        presumed dead and broken (unlink + re-acquire) with a WARN (Fallback-Path Logging rule).
      - Bounded wait: poll every LOCK_POLL_SEC (0.5s) up to LOCK_WAIT_SEC (60s); on timeout throw
        New-ActionableError. Constants mirror reconcile_grounding.py exactly.
      - Release: close the handle + unlink, in the caller's finally.

    NOTE: like the Python side, the lock is advisory and mtime-staleness assumes an operation
    completes within 120s; it does not heartbeat the mtime. This is intentional parity.
#>

Set-Variable -Name 'GroundingLockWaitSec'  -Value 60  -Scope Script -Option ReadOnly -Force
Set-Variable -Name 'GroundingLockStaleSec' -Value 120 -Scope Script -Option ReadOnly -Force
Set-Variable -Name 'GroundingLockPollSec'  -Value 0.5 -Scope Script -Option ReadOnly -Force

function Enter-GroundingLock {
    [CmdletBinding()]
    [OutputType([System.IO.FileStream])]
    param(
        [Parameter(Mandatory)][string]$LockPath,
        [int]$WaitSec = $script:GroundingLockWaitSec,
        [int]$StaleSec = $script:GroundingLockStaleSec,
        [double]$PollSec = $script:GroundingLockPollSec
    )
    Set-StrictMode -Version Latest

    $lockDir = Split-Path -Parent $LockPath
    if ($lockDir -and -not (Test-Path -LiteralPath $lockDir)) {
        throw (New-ActionableError -PassThru `
                -Goal     'Acquire the entity_mentions grounding lock' `
                -Problem  "Lock directory does not exist: $lockDir" `
                -Location 'Enter-GroundingLock' `
                -NextSteps @('Ensure the entity_mentions.json output directory exists before writing.'))
    }

    $start = Get-Date
    while ($true) {
        try {
            # CreateNew == O_CREAT|O_EXCL: succeeds only if the file does not already exist.
            return [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        }
        catch [System.IO.IOException] {
            if (Test-Path -LiteralPath $LockPath) {
                # Held by another writer — check mtime staleness.
                $age = ((Get-Date) - (Get-Item -LiteralPath $LockPath -Force).LastWriteTime).TotalSeconds
                if ($age -gt $StaleSec) {
                    Write-Warning "Enter-GroundingLock: breaking stale lock '$LockPath' (mtime age $([int]$age)s > ${StaleSec}s — holder presumed dead). Fallback-path per docs/error-handling.md."
                    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
                    continue   # re-acquire immediately
                }
                if (((Get-Date) - $start).TotalSeconds -ge $WaitSec) {
                    throw (New-ActionableError -PassThru `
                            -Goal     'Serialize the entity_mentions.json read-merge-write across grounding writers' `
                            -Problem  "Lock '$LockPath' held by another writer for >${WaitSec}s and not stale (mtime age $([int]$age)s)." `
                            -Location 'Enter-GroundingLock' `
                            -NextSteps @(
                                'Wait for the other grounding writer (reconcile_grounding.py or another Update-EntityMentionIndex) to finish.',
                                "If no writer is actually running, the lock is stale — remove it: $LockPath"
                            ))
                }
                Start-Sleep -Seconds $PollSec
            }
            else {
                # The lock was released between the failed create and this check (the race we are
                # waiting to win) — retry promptly, still bounded by the overall timeout.
                if (((Get-Date) - $start).TotalSeconds -ge $WaitSec) { throw }
                Start-Sleep -Milliseconds 50
            }
        }
    }
}

function Exit-GroundingLock {
    [CmdletBinding()]
    param(
        [System.IO.FileStream]$Handle,
        [Parameter(Mandatory)][string]$LockPath
    )
    Set-StrictMode -Version Latest
    if ($Handle) { try { $Handle.Close(); $Handle.Dispose() } catch { } }
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}
