Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    npm run dev
}
finally {
    Pop-Location
}
