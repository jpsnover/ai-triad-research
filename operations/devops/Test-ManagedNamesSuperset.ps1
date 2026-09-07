<#
.SYNOPSIS
    Pure predicate for the env-reconcile fail-closed guard (t/3345, TL t/3345#14).

.DESCRIPTION
    Decides whether the bicep-managed NAME set (`-NamesOnly` pass) is a safe superset of the
    literal-value key set. The reconcile in Sync-StagingEnv.ps1 deletes any live env key NOT in
    the managed-name set, so if a literal key were missing from that set it would be wrongly
    orphaned and DELETED live. This predicate is the fail-closed gate: it must hold before any
    removal runs.

    Extracted as a PURE function (t/2971 Guard Testability): the abort arm is not forceable in the
    script itself — the `-NamesOnly` regex (`{ name: 'X'`) is a strict prefix of the literal regex
    (`{ name: 'X', value: '…'`), so a real well-formed bicep can never make NamesOnly miss a literal
    key. Extracting the set-logic lets both arms be proven directly with CONSTRUCTED sets.

.OUTPUTS
    [pscustomobject] @{ Ok = [bool]; Missing = [string[]] }
      Ok=$true  → every literal key is present in ManagedNames (and ManagedNames is non-empty) → safe.
      Ok=$false → ManagedNames is empty, or one or more literal keys are absent (Missing lists them)
                  → the caller MUST abort the reconcile (fail-closed).
#>
function Test-ManagedNamesSuperset {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]] $LiteralKeys,
        [Parameter(Mandatory)] [AllowNull()] [AllowEmptyCollection()] [string[]] $ManagedNames
    )
    $names = @($ManagedNames)
    # Empty managed-name set = broken parse → never safe (would orphan everything).
    if ($names.Count -eq 0) {
        return [pscustomobject]@{ Ok = $false; Missing = @($LiteralKeys) }
    }
    # Membership (NOT count): every literal key must appear in the managed-name set. A count check
    # passes when a dropped literal key is offset by a spurious non-literal match — then the dropped
    # key gets deleted live. Collect the specific offenders for a diagnosable abort message.
    $missing = @($LiteralKeys | Where-Object { $_ -notin $names })
    return [pscustomobject]@{ Ok = ($missing.Count -eq 0); Missing = $missing }
}
