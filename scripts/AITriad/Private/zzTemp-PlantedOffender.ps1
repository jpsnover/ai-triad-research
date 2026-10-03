# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# TEMPORARY, t/3874 live-fire proof only -- deliberately over-threshold, not in the baseline.
# Reverted before merge; exists only to prove Test-ComplexityBudget reports a planted offender
# BY NAME on Linux CI (TL's requirement, t/3874#1), not just that false positives are gone.
function zzTemp-PlantedOffender {
    param($x)
    if ($x -eq 1) { 'a' } elseif ($x -eq 2) { 'b' } elseif ($x -eq 3) { 'c' }
    elseif ($x -eq 4) { 'd' } elseif ($x -eq 5) { 'e' } elseif ($x -eq 6) { 'f' }
    elseif ($x -eq 7) { 'g' } elseif ($x -eq 8) { 'h' } elseif ($x -eq 9) { 'i' }
    elseif ($x -eq 10) { 'j' } elseif ($x -eq 11) { 'k' } elseif ($x -eq 12) { 'l' }
    elseif ($x -eq 13) { 'm' } elseif ($x -eq 14) { 'n' } elseif ($x -eq 15) { 'o' }
    elseif ($x -eq 16) { 'p' } elseif ($x -eq 17) { 'q' } elseif ($x -eq 18) { 'r' }
    else { 'z' }
}
