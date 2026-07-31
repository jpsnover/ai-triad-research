# t/2025 CodeQL gate-verify — DOCS-ONLY case (throwaway, DO NOT MERGE, auto-deleted)

This PR touches only Markdown. CodeQL's path filter (`**.ts/.tsx/.js/.jsx`) means the
scan never triggers. Purpose: observe whether the evaluate-mode `code_scanning` rule
strands a no-run PR (blocks, waiting for results forever) or passes/skips it.
