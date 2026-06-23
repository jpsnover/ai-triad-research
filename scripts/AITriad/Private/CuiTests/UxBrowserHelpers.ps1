# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-UxNavigate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Url,
        [Parameter()][int]$TimeoutSec = 15
    )

    Invoke-CdpCommand -Session $Session -Method 'Page.navigate' -Params @{ url = $Url } -TimeoutSec $TimeoutSec
    Invoke-CdpCommand -Session $Session -Method 'Page.enable' -TimeoutSec 5 | Out-Null
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt ($TimeoutSec * 1000)) {
        $nav = Invoke-CdpCommand -Session $Session -Method 'Page.getNavigationHistory' -TimeoutSec 5
        if ($null -ne $nav) { break }
        Start-Sleep -Milliseconds 200
    }
}

function Invoke-UxClick {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Selector,
        [Parameter()][int]$TimeoutSec = 10
    )

    $escaped = $Selector -replace '\\', '\\\\' -replace "'", "\\\'"
    $js = @"
(() => {
  const el = document.querySelector('$escaped');
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { found: true };
})()
"@
    $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
        -Params @{ expression = $js; returnByValue = $true } -TimeoutSec $TimeoutSec
    if ($result.result.value.found -ne $true) {
        throw "Element not found: $Selector"
    }
}

function Invoke-UxType {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Selector,
        [Parameter(Mandatory)][string]$Text,
        [Parameter()][switch]$Clear,
        [Parameter()][int]$TimeoutSec = 10
    )

    $escapedSel = $Selector -replace '\\', '\\\\' -replace "'", "\\\'"
    $escapedText = $Text -replace '\\', '\\\\' -replace "'", "\\\'" -replace "`n", "\\n"
    $clearJs = if ($Clear) { "el.value = '';" } else { '' }
    $js = @"
(() => {
  const el = document.querySelector('$escapedSel');
  if (!el) return { found: false };
  el.focus();
  $clearJs
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) nativeInputValueSetter.call(el, '$escapedText');
  else el.value = '$escapedText';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { found: true };
})()
"@
    $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
        -Params @{ expression = $js; returnByValue = $true } -TimeoutSec $TimeoutSec
    if ($result.result.value.found -ne $true) {
        throw "Input element not found: $Selector"
    }
}

function Invoke-UxWaitForSelector {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Selector,
        [Parameter()][int]$TimeoutMs = 5000,
        [Parameter()][int]$PollMs = 200,
        [Parameter()][switch]$Hidden
    )

    $escaped = $Selector -replace '\\', '\\\\' -replace "'", "\\\'"
    $checkExpr = if ($Hidden) {
        "!document.querySelector('$escaped') || document.querySelector('$escaped').offsetParent === null"
    } else {
        "!!document.querySelector('$escaped')"
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
            -Params @{ expression = $checkExpr; returnByValue = $true } -TimeoutSec 5
        if ($result.result.value -eq $true) { return $true }
        Start-Sleep -Milliseconds $PollMs
    }
    return $false
}

function Invoke-UxScreenshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Path,
        [Parameter()][int]$TimeoutSec = 10
    )

    $dir = [System.IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $result = Invoke-CdpCommand -Session $Session -Method 'Page.captureScreenshot' `
        -Params @{ format = 'png' } -TimeoutSec $TimeoutSec
    $bytes = [System.Convert]::FromBase64String($result.data)
    [System.IO.File]::WriteAllBytes($Path, $bytes)
    $Path
}

function Invoke-UxGetText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Selector,
        [Parameter()][int]$TimeoutSec = 10
    )

    $escaped = $Selector -replace '\\', '\\\\' -replace "'", "\\\'"
    $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
        -Params @{ expression = "document.querySelector('$escaped')?.textContent ?? ''"; returnByValue = $true } `
        -TimeoutSec $TimeoutSec
    $result.result.value
}

function Invoke-UxEvaluate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Expression,
        [Parameter()][int]$TimeoutSec = 10
    )

    $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
        -Params @{ expression = $Expression; returnByValue = $true } -TimeoutSec $TimeoutSec
    $result.result.value
}

function Invoke-UxSelectOption {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Selector,
        [Parameter(Mandatory)][string]$Value,
        [Parameter()][int]$TimeoutSec = 10
    )

    $escapedSel = $Selector -replace '\\', '\\\\' -replace "'", "\\\'"
    $escapedVal = $Value -replace '\\', '\\\\' -replace "'", "\\\'"
    $js = @"
(() => {
  const el = document.querySelector('$escapedSel');
  if (!el) return { found: false };
  el.value = '$escapedVal';
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { found: true };
})()
"@
    $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
        -Params @{ expression = $js; returnByValue = $true } -TimeoutSec $TimeoutSec
    if ($result.result.value.found -ne $true) {
        throw "Select element not found: $Selector"
    }
}

function Invoke-UxElementExists {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Session,
        [Parameter(Mandatory)][string]$Selector,
        [Parameter()][int]$TimeoutSec = 5
    )

    $escaped = $Selector -replace '\\', '\\\\' -replace "'", "\\\'"
    $result = Invoke-CdpCommand -Session $Session -Method 'Runtime.evaluate' `
        -Params @{ expression = "!!document.querySelector('$escaped')"; returnByValue = $true } `
        -TimeoutSec $TimeoutSec
    $result.result.value -eq $true
}

function New-UxScreenshotDir {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$CuiId,
        [Parameter()][string]$BaseDir
    )

    if (-not $BaseDir) {
        $BaseDir = Join-Path ([System.IO.Path]::GetTempPath()) 'cui-screenshots'
    }
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dir = Join-Path $BaseDir "${CuiId}_${timestamp}"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $dir
}
