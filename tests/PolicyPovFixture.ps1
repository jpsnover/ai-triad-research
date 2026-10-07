# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared fixture helper for the policy-registry suites (t/4065). Dot-source it, then call it after a
# fixture writes the POV file(s) it cares about.
#
# The reference scan refuses a missing, null, nodes-less or empty POV file (Read-PolicyPovFile), so
# every fixture needs all four, each with at least one node. A missing file is written with a single
# filler node that references no policy, and a file whose nodes array is empty gets that filler added.
# "No longer referenced" in a test then means no node references the id, not that the file is empty.
# Same convention as the TS handler suites (#3050, e/274#4).
function Add-PolicyPovFillers {
    param([Parameter(Mandatory)][string]$Dir)
    foreach ($Pov in 'accelerationist', 'safetyist', 'skeptic', 'situations') {
        $Path = Join-Path $Dir "$Pov.json"
        $Filler = [ordered]@{ id = "$Pov-fixture-filler" }
        if (-not (Test-Path -LiteralPath $Path)) {
            $Data = [ordered]@{ _schema_version = '1.0.0'; nodes = @($Filler) }
        }
        else {
            $Data = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
            if (@($Data.nodes).Count -gt 0) { continue }
            $Data.nodes = @($Filler)
        }
        $Data | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8
    }
}
