**Debate-Tested Reliability Study — Rater Instructions**
**Study ID:** t/1586 | **Seed:** 1586 | **Items:** 60

---

## What you are rating

Each row in `debate-tested-rating-sheet.csv` describes one AI-policy belief from the debate taxonomy. You will assign a **testing tier** based solely on the node's debate history as recorded. The tier reflects how much adversarial scrutiny the belief has survived in structured three-way debates (Accelerationist / Safetyist / Skeptic). It does not measure whether the belief is true.

---

## The four tiers

Assign exactly one of these strings in the `rater_assigned_tier` column:

| Tier | When to assign |
|---|---|
| `untested` | The belief has never appeared in any debate. No testing history exists. |
| `cited` | The belief appeared in one or more debates but was never the direct target of a challenge. It entered the debate context without being attacked. |
| `contested` | The belief was directly challenged in at least one debate (see "DIRECTLY CHALLENGED" in the history), but either it was challenged fewer than twice in separate debates, or the outcome record is mixed or inconclusive. |
| `well_tested` | The belief was directly challenged in two or more separate debates, and the challenges were largely held off (claims survived or thrived more than they died). |

---

## Reading the history column

The `testing_history` field shows one line per debate appearance, in chronological order (oldest first).

**"appeared — not directly challenged"**
The belief entered this debate's context window but no direct attack was registered against it. It may have been referenced by a debater without being contested.

**"DIRECTLY CHALLENGED and held — [scheme] by [camp], attack_strength=X, claims: thrived=N survived=N died=N"**
A debater mounted a direct attack on this belief using the named argumentative scheme (rebut / undercut / undermine). The belief held — more claims survived or thrived than died. `attack_strength` ranges 0-1; higher means a stronger attack was mounted.

**"DIRECTLY CHALLENGED and weakened — ..."**
As above, but the belief was weakened — too many claims died under the attack.

**"appeared — challenge outcome inconclusive (claims: ...)"**
The belief appeared in a debate with mixed claim outcomes but no clear held or weakened verdict.

---

## Ground rules

1. **Rate from the history only.** Do not use your own knowledge of the belief or the named organizations to override what the history shows.
2. **Fill every row.** If the history is ambiguous between two tiers, choose the lower one and add a note in `rater_notes`.
3. **Blind discipline.** Do not discuss your ratings with other raters until you have finished all 60 items.
4. **Drift note.** If your interpretation of a tier shifts during the session, add a note in `rater_notes` for the item where you noticed the shift.
5. The `node_id` and `label` columns are for reference only; the description and history are the evidence.

---

## Decision tree

```
Does the node have any debate history?
  NO  → untested

  YES → Was it ever "DIRECTLY CHALLENGED" in any entry?
          NO  → cited

          YES → Was it "DIRECTLY CHALLENGED" in 2 or more SEPARATE entries?
                  NO  → contested

                  YES → In those challenged entries, do claims mostly survive (thrived+survived > died)?
                          YES → well_tested
                          NO  → contested
```

---

## Pre-registered decision thresholds (for CL use after rating)

| Result | Outcome |
|---|---|
| Quadratic-weighted κ ≥ 0.70 and Krippendorff's α ≥ 0.70 | Instrument accepted; Phase 1 UI ships without caveat |
| 0.50 ≤ α < 0.70 | Instrument accepted with "experimental" label on tier chip |
| α < 0.50 | Investigation required before Phase 3 (scheduler) authorized |

These thresholds are stated to the rater in advance so no post-hoc adjustment is possible.
