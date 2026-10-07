# THROWAWAY (t/3553 item 8 red arm, never merge): one registered id absent from codeReferencedModels.json.
Describe 'T3553 arm' { It 'carries a literal' { $cmd = "Invoke-Thing -Model 'gemini-3.1-pro-preview'"; $cmd | Should -Not -BeNullOrEmpty } }
