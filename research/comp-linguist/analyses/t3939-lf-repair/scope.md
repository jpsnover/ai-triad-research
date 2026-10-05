# Live logical_form repair: scope

**Ticket:** t/3939 (from t/3884). It supersedes the targeted class-B apply pending in t/3351#4.
**Date:** 2026-10-05
**Data base:** ai-triad-data 8022a263 (a clean worktree, not the shared checkout)
**Status:** Proposal awaiting PI authorization. Nothing has been written.

## Question

Which live node frames should be rewritten now that the formalizer drops scope notes and the v3.1b main-clause rule is live?

## Measurement

All 642 grounded nodes were formalized 3 times, using the cleaned input and the live prompt (dry, 1925 of 1926 drafts succeeded). Each node's majority predicate was compared with its live one (`scope.txt`):

- **471** nodes: the fresh majority predicate matches the live one.
- **170** nodes: it differs. 136 of these are unanimous across the 3 drafts.
- **1** node has no 2-of-3 majority.

Different is not better. Across nodes with a fresh majority:
- **class B** (discourse as agent) falls from 9 to 0;
- **class A** (stance leak) rises from 1 to 5.

The 5 new leaks (`targeted.txt`) are acc-beliefs-044, acc-desires-042, saf-intentions-044, saf-intentions-059 and skp-desires-059. Most of the other differences are synonym choices (`abolish` and `eliminate`, `absorb` and `integrate`). Some are regressions: acc-intentions-103 goes from the correct `prohibit` to `impose`.

**A bulk rewrite is therefore rejected.** It would add about as many defects as it removes, and it would reset every rewritten frame from `accepted` to `proposed`, undoing the t/3239 approvals.

Whole fresh frames are not clean even where the predicate improves. CL's per-frame review of the 9 candidates found:
- **acc-intentions-008:** the agent becomes `"Advocates"`, the meta-collective the prompt bans (the class-B regex misses it).
- **acc-desires-021:** the agent becomes `"domestic"`.
- **saf-intentions-149:** the mandated system is cast as the agent.
- **Instability:** the arguments disagree across drafts in 7 of the 9.

## Proposal: 11 operations (`frozen-ops.json`)

**9 x `drop_discourse_agent`** on acc-intentions-008, acc-desires-021, acc-intentions-096, acc-intentions-103, acc-beliefs-070, saf-intentions-048, saf-intentions-149, saf-intentions-217 and skp-intentions-055:
- Each op removes only the one `args[]` entry whose role is agent and whose ref is `lit:"<camp> discourse"`.
- Each frame keeps at least one argument afterwards.
- Predicate, other arguments, grounded references and `status: accepted` are all unchanged.
- The op is deterministic and needs no model.
- It clears every class-B defect in the corpus.

**2 x `replace_frame`** on saf-intentions-127 (`hold` to `give`) and skp-beliefs-232 (`maintain` to `destroy`):
- Each takes a fresh frame whose predicate was unanimous across 3 drafts and correct against the t/3884 gold set.
- The new frames carry `status: proposed`, so those two nodes need re-promotion review.

**Left as known residuals:**
- **acc-desires-021** keeps its `prioritize` stance leak. The surgical op does not choose a predicate, and the fresh frame's agent is unusable.
- **skp-beliefs-125**'s "Public AI Discourse" is a patient. It is correct content and a scanner false positive, so it is not touched.

**0-collateral precondition:** all three taxonomy files round-trip through the serializer byte-identically at 8022a263. An apply can therefore change exactly the 11 frames and nothing else.

## What the apply will need, once authorized

/data-mutation discipline:
- the frozen list matches at apply time (`before_sha16` per frame);
- recorded PI authorization;
- the apply runs from a data worktree;
- the diff touches only the 11 frames;
- a second agent re-counts (class B is 0; the 2 predicates have changed);
- the 2 replaced frames are re-promoted.

The apply script is written after the decision, so that it matches the option the PI picks.
