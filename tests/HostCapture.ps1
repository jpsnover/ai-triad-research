# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Platform-independent Write-Host capture for the characterization harnesses (t/4081).
#
# HostInformationMessage.ForegroundColor is the host's default when -ForegroundColor isn't passed:
# Gray on a Windows console, -1 on Linux CI. Goldens recorded on Windows therefore failed on Linux
# for every bare Write-Host. An explicit Gray is indistinguishable from the default after the fact,
# so the colour is captured where it's decided: a Write-Host mock in the AITriad module that records
# the colour only when -ForegroundColor was bound, and 'default' otherwise.
#
# Usage, in the scope that invokes the cmdlet (It/BeforeEach):
#     Register-HostCaptureMock
#     <cmdlet> ... 6>&1 | ...
#     $h = Get-HostCaptureParts $record.MessageData   # @{ Color; Message } or $null
function Register-HostCaptureMock {
    # Inside a Pester mock body the bound parameters are $PesterBoundParameters; $PSBoundParameters
    # there is empty, which would record every explicit colour as 'default'.
    Mock Write-Host -ModuleName AITriad {
        $color = if ($PesterBoundParameters.ContainsKey('ForegroundColor')) { [string]$ForegroundColor } else { 'default' }
        $sep = if ($PesterBoundParameters.ContainsKey('Separator')) { [string]$Separator } else { ' ' }
        $msg = (@($Object) | ForEach-Object { [string]$_ }) -join $sep
        $nn = $PesterBoundParameters.ContainsKey('NoNewline') -and [bool]$NoNewline
        Write-Information -MessageData ([pscustomobject]@{ HostCaptureColor = $color; Message = $msg; NoNewLine = $nn })
    }
}

# Returns @{ Color; Message; NoNewLine } for a captured record, or $null for a plain
# Write-Information record. A HostInformationMessage still reaching here came from outside the
# AITriad module (not mocked); its colour is normalised by comparing with the host default.
function Get-HostCaptureParts {
    param($MessageData)
    if ($null -ne $MessageData -and $MessageData.PSObject.Properties['HostCaptureColor']) {
        return @{ Color = $MessageData.HostCaptureColor; Message = [string]$MessageData.Message; NoNewLine = [bool]$MessageData.NoNewLine }
    }
    if ($MessageData -is [System.Management.Automation.HostInformationMessage]) {
        $color = if ($null -eq $MessageData.ForegroundColor -or $MessageData.ForegroundColor -eq $Host.UI.RawUI.ForegroundColor) { 'default' } else { [string]$MessageData.ForegroundColor }
        return @{ Color = $color; Message = [string]$MessageData.Message; NoNewLine = [bool]$MessageData.NoNewLine }
    }
    $null
}
