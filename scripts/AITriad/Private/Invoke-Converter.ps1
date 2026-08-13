# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Private dispatch wrappers for DocConverters functions.
# Keeping calls inside AITriad's scope allows Pester to mock them with -ModuleName AITriad.
function Invoke-PdfConversion {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    ConvertFrom-Pdf -PdfPath $Path
}

function Invoke-DocxConversion {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    ConvertFrom-Docx -DocxPath $Path
}
