# Project-Template root module
# Dot-sources all Public (exported) and Private (internal) functions.
# Rename this file and directory to match your project after cloning from the template.

$script:ModuleRoot = $PSScriptRoot

# Detect repo root — walk up from module location looking for .git
$script:RepoRoot = $PSScriptRoot
while ($script:RepoRoot -and -not (Test-Path (Join-Path $script:RepoRoot '.git'))) {
    $script:RepoRoot = Split-Path $script:RepoRoot -Parent
}
if (-not $script:RepoRoot) { $script:RepoRoot = $PSScriptRoot }

# Dot-source private helpers first (other functions depend on them)
foreach ($file in (Get-ChildItem -Path "$PSScriptRoot/Private/*.ps1" -ErrorAction SilentlyContinue)) {
    . $file.FullName
}

# Dot-source public functions
foreach ($file in (Get-ChildItem -Path "$PSScriptRoot/Public/*.ps1" -ErrorAction SilentlyContinue)) {
    . $file.FullName
}
