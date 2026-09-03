# Config-drift in-process-flag-assert predicate (t/3247 — prevention for the t/3165 incident).
#
# PURE predicate (Guard Testability, t/2971): given the boot-log line(s) for a target revision,
# decides whether the RUNNING process evaluated EMBEDDING_WORKER_OFFLOAD truthy. The #1793
# config-drift gate proves the env var is PRESENT in ACA config; this proves the process
# EVALUATED it — "config present" != "flag effective" (the t/3165 whipsaw hypothesis: a durable
# rev could mint the env var in a form process.env reads differently than the CLI-flip did).
#
# CONTRACT COUPLING (t/3247 GV cond 3) — keys on ServerAPI's #1828 boot line emitted at
#   taxonomy-editor/src/server/server.ts:1316:
#     log.server.info({ embeddingWorkerOffload: isEmbeddingWorkerOffloadEnabled() }, 'embedding offload flag at boot')
#   -> Pino JSON: {..., "embeddingWorkerOffload": true|false, "msg":"embedding offload flag at boot"}
#   If that emit changes (field name OR message), update BOTH ends (here + server.ts) and the fixture.
#
# CO-LOCATION (t/3010 pattern): the deploy-azure.yml gate step AND
# tests/Test-BootFlagEffective.Tests.ps1 both dot-source THIS file — single source of truth, so
# the gate and its proof can never diverge.

function Test-BootFlagEffective {
    [CmdletBinding()]
    param(
        # Console-log lines (raw Pino JSON strings) for the target revision. Scans for the #1828
        # boot line and reads the flag from the LAST such line (restart/scale emits one per replica
        # — latest wins).
        [Parameter(Mandatory)][AllowEmptyCollection()][AllowNull()][AllowEmptyString()][string[]]$BootLogLines,
        [Parameter()][string]$FlagField   = 'embeddingWorkerOffload',
        [Parameter()][string]$BootMessage = 'embedding offload flag at boot',
        [Parameter()][bool]$Expected      = $true
    )

    # Regex extraction (not ConvertFrom-Json): robust to Pino duplicate-key lines and to unrelated
    # malformed console output the platform may interleave (a JSON parse would throw on those).
    $pattern = '"' + [regex]::Escape($FlagField) + '"\s*:\s*(true|false)'
    $last = $null
    foreach ($line in ($BootLogLines | Where-Object { $_ })) {
        if ($line -notlike "*$BootMessage*") { continue }   # only the #1828 boot line counts
        $m = [regex]::Match($line, $pattern)
        if ($m.Success) { $last = $m.Groups[1].Value }
    }

    if ($null -eq $last) {
        # DISTINCT from drift (GV cond 2): the boot line/field was not found. Fail-closed, but the
        # cause is likely Log Analytics ingestion lag or a changed #1828 emit — NOT a flag regression.
        return [pscustomobject]@{
            Status = 'NotFound'
            Value  = $null
            Pass   = $false
            Detail = "boot line not found (field '$FlagField' in msg '$BootMessage') — check Log Analytics ingestion lag or the #1828 emit at server.ts:1316; this is NOT config drift"
        }
    }

    $value = ($last -eq 'true')
    if ($value -eq $Expected) {
        return [pscustomobject]@{
            Status = 'Effective'
            Value  = $value
            Pass   = $true
            Detail = "in-process flag effective: $FlagField=$value (expected $Expected)"
        }
    }

    return [pscustomobject]@{
        Status = 'Drift'
        Value  = $value
        Pass   = $false
        Detail = "config drift: EMBEDDING_WORKER_OFFLOAD present in ACA config but the process evaluated $FlagField=$value (expected $Expected) — present != effective (t/3165)"
    }
}
