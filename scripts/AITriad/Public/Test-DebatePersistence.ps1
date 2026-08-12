function Test-DebatePersistence {
    <#
    .SYNOPSIS
        Probes the debate output directory with an atomic write+rename before AI generation begins.
    .DESCRIPTION
        Writes a random-named sentinel .tmp file to the debates directory, renames it to .json
        (matching the atomic-write pattern used by the debate engine), then deletes it.
        Returns a DebatePersistenceResult with Status OK, LOCKED, or NO_PERMISSION so callers
        can surface a user-facing warning before expensive AI generation starts.
    .PARAMETER DebatesDir
        Path to the debates output directory. Defaults to Get-DebatesDir.
    .OUTPUTS
        DebatePersistenceResult
    .EXAMPLE
        $r = Test-DebatePersistence
        if ($r.Status -ne 'OK') { Write-Warning "Debate saves will fail: $($r.Status) at $($r.Path)" }
    #>
    [CmdletBinding()]
    [OutputType('DebatePersistenceResult')]
    param(
        [Parameter()]
        [string]$DebatesDir
    )

    Set-StrictMode -Version Latest

    if ([string]::IsNullOrWhiteSpace($DebatesDir)) {
        $DebatesDir = Get-DebatesDir
    }

    if (-not (Test-Path -LiteralPath $DebatesDir -PathType Container)) {
        try {
            $null = New-Item -ItemType Directory -Path $DebatesDir -Force -ErrorAction Stop
        } catch {
            $r = [DebatePersistenceResult]::new()
            $r.Status     = 'NO_PERMISSION'
            $r.Path       = $DebatesDir
            $r.LockHolder = $null
            return $r
        }
    }

    $BaseName  = "persist-probe-$([System.IO.Path]::GetRandomFileName())"
    $TmpPath   = Join-Path $DebatesDir "$BaseName.tmp"
    $FinalPath = Join-Path $DebatesDir "$BaseName.json"

    try {
        [System.IO.File]::WriteAllText($TmpPath, '{"probe":true}')

        Rename-Item -LiteralPath $TmpPath -NewName "$BaseName.json" -ErrorAction Stop

        Remove-Item -LiteralPath $FinalPath -ErrorAction Stop

        $r = [DebatePersistenceResult]::new()
        $r.Status     = 'OK'
        $r.Path       = $DebatesDir
        $r.LockHolder = $null
        return $r

    } catch [System.UnauthorizedAccessException] {
        $r = [DebatePersistenceResult]::new()
        $r.Status     = 'NO_PERMISSION'
        $r.Path       = $DebatesDir
        $r.LockHolder = $null
        return $r

    } catch [System.IO.IOException] {
        $r = [DebatePersistenceResult]::new()
        $r.Status     = 'LOCKED'
        $r.Path       = $DebatesDir
        $r.LockHolder = $null
        return $r

    } catch {
        $r = [DebatePersistenceResult]::new()
        $r.Status     = 'NO_PERMISSION'
        $r.Path       = $DebatesDir
        $r.LockHolder = $null
        return $r

    } finally {
        if (Test-Path -LiteralPath $TmpPath)   { Remove-Item -LiteralPath $TmpPath   -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $FinalPath) { Remove-Item -LiteralPath $FinalPath -ErrorAction SilentlyContinue }
    }
}
