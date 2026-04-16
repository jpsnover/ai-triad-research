# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Drop-in replacement for Set-Content with UTF8 encoding that writes UTF-8
# WITHOUT a BOM. Windows PowerShell 5.1's `-Encoding UTF8` emits a BOM, which
# Node's JSON.parse and other cross-platform tools reject. PS 7's `utf8NoBOM`
# exists but this helper keeps the module compatible with both editions.
function Write-Utf8NoBom {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Path,

        [Parameter(Mandatory=$true, ValueFromPipeline=$true, Position=1)]
        [AllowEmptyString()]
        $Value,

        [switch]$NoNewline,
        # Accepted for Set-Content compat — file writes always overwrite.
        [switch]$Force
    )
    begin {
        $parts = New-Object System.Collections.Generic.List[string]
    }
    process {
        if ($null -ne $Value) {
            if ($Value -is [array]) {
                foreach ($item in $Value) { $parts.Add([string]$item) }
            } else {
                $parts.Add([string]$Value)
            }
        }
    }
    end {
        $text = $parts -join "`n"
        if (-not $NoNewline -and $text.Length -gt 0 -and $text[$text.Length - 1] -ne "`n") {
            $text += "`n"
        }
        $enc = New-Object System.Text.UTF8Encoding($false)
        $dir = Split-Path -Path $Path -Parent
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        [System.IO.File]::WriteAllText($Path, $text, $enc)
    }
}
