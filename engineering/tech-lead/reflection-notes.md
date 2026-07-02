# Reflection Notes — Session Transcript Analysis

**Date:** 2026-07-02
**Method:** 5 parallel extraction agents grepped ~2 GB of session transcripts across 50+ sessions in `~/.claude/projects/` (ai-triad-research all roles, FamilyOS, misc). Counts are regex occurrences, not distinct incidents; agents flagged false-positive classes (e.g., `429`/`timeout` matching feature code) and those are excluded from conclusions below.

Ranked most leverage first.

---

## 1. FIX (urgent): Broken hook pipes its JSON payload through cmd.exe — ~60,000+ error events corpus-wide

**Verdict: fix — highest-leverage item by an order of magnitude.**

A PreToolUse/PostToolUse hook on Windows passes its JSON payload to cmd.exe **as a command line** instead of stdin. Every tool call in nearly every session appends:

```
'{"session_id":"019e..."}' is not recognized as an internal or external command
```

with `exitCode: 0` — so it never surfaces as a failure, it just silently pollutes every tool result and bloats every transcript. When the payload exceeds cmd.exe's 8,191-char limit, it adds `The input line is too long` and then **executes word-split JSON fragments as commands** — this is the direct mechanism behind the zero-byte junk files (`0`, `false`, `r.node.id)`, `{}`, `scripts/$null`) cleaned out of `lib/debate/` and `scripts/` on 2026-07-01/02.

**Evidence:**
- tech-lead session `019e4a98` (336 MB): 26,491 occurrences
- lib-debate `019e758f` (283 MB): 15,262 + 18,574 "input line too long"
- comp-linguist `019e49f7` (219 MB): 17,122 + 5,761
- taxonomy-editor `019e4714` (721 MB): 21,756 "input line too long" + 33,010 "not recognized"
- operations dirs (DIAG/DEVOPS/AZURE/ROOT/PM): 19,620 combined
- FamilyOS + misc (13 dirs): ~6,400 — it follows the user to **new workspaces**
- Transcript bloat is a real cost: these strings are a plausible major contributor to 300–700 MB transcript files, which then cause context exhaustion ("session continued from a previous conversation that ran out of context" observed 3× in one file's samples).

**Fix direction:** audit configured hooks/feedback rules (Orca `list_feedback_rules` + `.claude/settings.json`) for any hook whose command receives JSON as an argument on Windows. Known lesson class already in MEMORY.md (".cjs + absolute paths + test end-to-end") — one hook still violates it. This single fix removes the #1 noise source, stops junk-file creation, and shrinks future transcripts substantially.

---

## 2. FIX: Hook-banner noise is untargeted — six-figure token tax per long session

**Verdict: fix — tune existing feedback rules; near-zero build cost.**

Instructional hook banners fire regardless of relevance:
- `FETCH-THROUGH-BRIDGE` fired 363× in the tech-lead session and 464× in the **PowerShell** session — pure PS work receiving renderer-fetch lectures on every Edit/Write (including writes to `LAST_SESSION.md`).
- `STRICT MODE .Count` fired 409× (TL) / 777× (scripts) — even for `.md` edits.
- taxonomy-editor mega-session: **81,922** hook-context injections.
- "ping the Sage agent" PostToolUseFailure fires on trivial/expected failures (269× across sessions) — e.g., it demanded a Sage incident report for a `cd` typo.
- "Still accurate? Call update_status" nag: 822× in one session.

**Fix direction:** add path/file-type conditions to the FETCH-THROUGH-BRIDGE and STRICT-MODE rules (only fire on `src/renderer/**` and `*.ps1` respectively); raise the Sage-ping rule's threshold to real failure classes; reduce status-nag frequency. Recurrence is every-session; build cost is minutes.

---

## 3. FIX/AUTOMATION: `ogit` long-form expansion typed ~12,000+ times

**Verdict: fix — one-line git alias.**

Because `ogit` is a shell alias unavailable in non-interactive shells, agents expand it to `git --git-dir=.orca-git --work-tree=.` constantly: 6,722× (taxonomy-editor session), 3,115× (devops), 2,615× (tech-lead), 1,453× (azure), 1,011× (diagnostics)… Agents also still occasionally hit `ogit: command not found` (orca-support, 2026-05-31) and get pathspec confusion when running from subdirectories (observed this session: `status -- AGENTS.md` silently matched nothing from a subdir).

**Fix direction:** a repo-level git alias (`git config alias.og '!git --git-dir=.orca-git --work-tree=.'`) or a checked-in `scripts/ogit.ps1` wrapper, plus one AGENTS.md line pointing at it. Kills thousands of long-form repetitions and the subdirectory pathspec trap.

---

## 4. AUTOMATION: Deploy verification is manual polling — same run ID polled 20–27×

**Verdict: automation + land the pending fix (t/702).**

DevOps/Azure sessions poll `gh run view <same-id>` in tight manual loops: 27× on run 27774785072, 22×, 21×, 21×, 24× on other runs — 1,797 `gh run view` invocations total across ops sessions. Compounding it, the known deploy false-red (`failOnStdErr` + Bicep warnings, tracked as t/702) means agents *must* dig into logs to distinguish real failures, and the workaround text ("read gh run view --log-failed, not just az deployment list") appears 80× as re-pasted boilerplate.

**Fix direction:** (a) land t/702 so green means green; (b) standardize on `gh run watch <id>` or a background task + notification pattern in the DevOps runbook/AGENTS.md instead of poll loops. Skill probably unnecessary — one runbook paragraph does it.

---

## 5. FIX: `update_status` entity-reference rejections — same mistake in 7+ workspaces, 300+ bounces

**Verdict: fix — one line in root AGENTS.md (and suggest Orca auto-strip upstream).**

Agents systematically write `t/NNN` into status text and get bounced by validation: 150 rejections in the tech-lead session alone, 111 across ops dirs, 11 across FamilyOS/misc — top single `is_error:true` cause in 4 of 5 ops directories. Every agent re-learns this rule by failing it (I hit it again this session).

**Fix direction:** add to root AGENTS.md ("status text: describe the work, never include t/, p/, e/ refs"), and/or a feedback rule that rewrites instead of rejects. Ideal fix is upstream (Orca auto-strip), worth filing.

---

## 6. SKILL: Flight-recorder triage — the one genuinely recurring workflow without a playbook

**Verdict: new skill (`/triage-flight-recorder`), Diagnostics-scoped.**

The diagnostics sessions (3 files, 112 MB) show a recurring intake pattern: user pastes an error + raw dump path (`...AppData\Roaming\taxonomy-editor\flight-recorder\flight-recorder-*.jsonl`), and the agent re-derives the same workflow each time — 9,851 `flight-recorder` + 12,492 `.jsonl` mentions in DIAG alone. The hard-won rules already exist but only as memory notes: check `context.app.build_date` before claiming a fix is missing; git SHA unreliable (local uncommitted builds); always check for the paired `server-flight-recorder-*.jsonl`; never open the HTML viewer.

**Fix direction:** encode those rules as a skill that takes a dump path and runs the standard triage sequence. Real recurrence (every production incident), moderate build cost, high consistency payoff.

---

## 7. NOTHING (mitigation already built): Gemini free-tier rate limiting

Massive raw counts (25k "rate limit" mentions taxonomy-editor group) but the deep-dives show most are *design/implementation text* for the multi-key round-robin mitigation, which shipped. Verified-live throttle events are modest (72 flight-recorder `api.error: Rate limited` on 2026-06-23, during batch work). The engineering response already happened; no further setup change warranted. Monitor via `Get-AICostReport`/`Get-FreeTierStatus`.

## 8. NOTHING (tooling exists): Debate run fragility

Crash/recovery signals are real (612 `partial.json`, 149 `Resume-AITDebate`, 183 "hung", a 4-hour hang found only by manual polling) but concentrated in two sessions that *built* the remedies: `Resume-AITDebate`, `Watch-DebateProgress` (hung detection), EPERM retry utilities. Re-assess only if hangs recur post-tooling. One residual: interactive prompts hanging builds (`echo y | npm run build` workaround) — worth a single AGENTS.md trap line if seen again.

## 9. NOTHING (guidance exists, behavioral): Full-suite test re-run churn

288 verify/vitest invocations in one lib-debate session; the Test Tiers table in AGENTS.md already prescribes targeted Tier-1 runs during development. This is compliance, not missing setup. The junk-noise fixes (#1, #2) will also reduce the failure-retry loops that drive some of it.

## 10. WATCH: Shell cwd resets (~10,000 events)

`Shell cwd was reset` fires on nearly every PowerShell call (harness behavior), forcing `Set-Location` prefixes. Not directly fixable in user config; agents' correct adaptation is absolute paths (already the harness guidance). Listed for the record because it amplifies #3-style boilerplate; no build.

---

## Cross-cutting observation

Real user corrections are rare and mostly *observed-behavior mismatches* ("I don't see it in the UX", screenshot + path) rather than instruction reversals — the agent workforce is following instructions well; the friction is overwhelmingly **environmental** (one broken hook, untuned hook rules, Windows shell interop, missing tiny wrappers). Items 1–3 together likely account for the majority of wasted tokens and transcript bloat across every session.
