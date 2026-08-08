# Gate-verification fixture — TEMPORARY, remove before merge (t/2331)
# Proves compliance-live.yml fires red on a data regression.
# Replace with real test from t/2332 (#674).
Describe "SituationBDI LiveData [gate-verification fixture]" {
    It "fails deliberately to prove compliance-live.yml fires on regression" {
        $false | Should -BeTrue
    }
}
