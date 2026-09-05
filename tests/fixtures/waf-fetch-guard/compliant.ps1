# Fixture (t/3314): compliant fetches the guard must PASS — a literal internal host (host-literal
# auto-allow) and a variable-URL fetch that declares itself with a co-located marker.
function Get-FixtureInternalThings {
    param([string]$Uri)

    # Literal known-internal host → auto-allowed, no marker needed.
    $models = Invoke-RestMethod -Uri 'https://api.groq.com/openai/v1/models' -Method Get -TimeoutSec 10

    # fetch-allowlist: internal taxonomy-editor API base (not user-supplied, our own service)
    $cfg = Invoke-RestMethod -Uri "$Uri/api/admin/config" -Method Get -TimeoutSec 10

    return @($models, $cfg)
}
