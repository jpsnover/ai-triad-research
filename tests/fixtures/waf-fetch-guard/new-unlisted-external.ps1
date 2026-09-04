# Fixture (t/3314): a NEW cmdlet that fetches a user-supplied external URL via PowerShell — the exact
# WAF-blockable pattern the guard must FLAG. Not dot-sourced by the module; scanned by the guard test
# only. There is deliberately no allowlist marker and no allowlisted literal host here.
function Get-FixtureExternalThing {
    param([string]$Url)
    $Resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30   # <-- must be flagged
    return $Resp.Content
}
