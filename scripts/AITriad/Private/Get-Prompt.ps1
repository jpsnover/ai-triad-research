function Get-Prompt {
    <#
    .SYNOPSIS
        Loads a .prompt file from the Prompts/ directory with optional placeholder replacement.
    .DESCRIPTION
        Reads a prompt template from scripts/AITriad/Prompts/<Name>.prompt, caches
        the raw text in $script:PromptCache, and optionally substitutes {{KEY}}
        placeholders with values from the -Replacements hashtable.
    .PARAMETER Name
        Base name of the prompt file (without .prompt extension).
    .PARAMETER Replacements
        Hashtable of placeholder replacements. Keys are matched as {{KEY}} in the
        prompt text (case-sensitive).
    .EXAMPLE
        Get-Prompt -Name 'pov-summary-system'
    .EXAMPLE
        Get-Prompt -Name 'general-taxonomy-pov' -Replacements @{ POV_LABEL = 'Safetyist' }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [string]$Name,

        [hashtable]$Replacements = @{}
    )

    if (-not (Get-Variable -Name 'PromptCache' -Scope Script -ErrorAction SilentlyContinue)) {
        $script:PromptCache = @{}
    }

    if (-not $script:PromptCache.ContainsKey($Name)) {
        $PromptPath = Join-Path $script:ModuleRoot 'Prompts' "$Name.prompt"
        if (-not (Test-Path $PromptPath)) {
            throw "Prompt file not found: $PromptPath"
        }
        $script:PromptCache[$Name] = (Get-Content -Path $PromptPath -Raw).TrimEnd()
    }

    $Text = $script:PromptCache[$Name]

    foreach ($Key in $Replacements.Keys) {
        $Text = $Text -replace [regex]::Escape("{{$Key}}"), $Replacements[$Key]
    }

    return $Text
}