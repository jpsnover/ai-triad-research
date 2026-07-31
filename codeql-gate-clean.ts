// t/2025 CodeQL gate-verify — CLEAN case (throwaway, DO NOT MERGE, auto-deleted).
// Benign TS: CodeQL runs (matches the **.ts trigger) and must find NO new high
// alert, so the evaluate-mode code_scanning rule should PASS this PR even though
// main carries 39 pre-existing critical+high alerts — the differential proof.
export const codeqlGateClean = 42;
