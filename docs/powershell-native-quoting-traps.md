# PowerShell → Native Command Quoting Traps

**Last updated:** 2026-07-04
**Author:** Technical Lead (AI Triad Research)
**Origin:** every entry below cost us real debugging time in production sessions. The general rule already exists (ADR-004: use Edit/Write tools, never shell-escape code); this doc covers the residue — arguments to *native executables* that must pass through PowerShell's argument parser.

## The headline incident (2026-07-04)

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\id_ed25519 -N '""'   # WRONG
```

Intent: empty passphrase. Reality: PowerShell passed the two-character string `""` to ssh-keygen as the passphrase. The key *worked* for public-key matching (GitHub said "server accepts key") but **signing silently failed** in BatchMode — `Permission denied (publickey)` with no hint that the local key was passphrase-locked. Cost: ~20 minutes of auth debugging during a migration push.

**Correct forms:**
```powershell
ssh-keygen -t ed25519 -f $path -N ''          # PS 7.3+ with PSNativeCommandArgumentPassing=Standard
cmd /c "ssh-keygen -t ed25519 -f $path -N `"`""   # or route through cmd, which passes "" as empty
```

**Diagnosis technique worth remembering:** when SSH says "server accepts key" but auth still fails, the private key can't sign. Test which passphrase the key actually has:
```powershell
& ssh-keygen -y -P '' -f $path      # try empty
& ssh-keygen -y -P '""' -f $path    # try the literal two-quote string (this one hit)
```
If a candidate prints the public key, that's the passphrase. Fix in place without touching the server side:
```powershell
& ssh-keygen -p -f $path -P '<found>' -N ''
```

## The trap taxonomy

Every one of these is the same root cause: **your string passes through multiple parsers** (PowerShell → native arg parser → sometimes cmd or bash), and each layer eats or preserves quotes differently.

| Trap | Wrong | What happens | Right |
|---|---|---|---|
| Empty-string arg to native exe | `-N '""'` | Literal `""` (2 chars) delivered | `-N ''` (PS7 Standard passing) or route via `cmd /c` |
| PS scope operator in strings | `"text$ctx: more"` | `$ctx:` parsed as scope-qualified variable → empty | `"text${ctx}: more"` |
| PS here-string in Bash tool | `git commit -m @'...'@` in bash | Bash has no `@'...'@`; splits lines into pathspec args | Here-strings only in the PowerShell tool; in bash, `git commit -F <tmpfile>` |
| Git flags after `--` | `git commit -- <paths> -m "msg"` | Everything after `--` is a pathspec; `-m` becomes a filename | All flags BEFORE `--` |
| Nested quotes through `cmd /c '...'` | `cmd /c 'x -P """"'` | cmd's quote-escaping collapses `""""` unpredictably | Prefer `&` direct invocation from PS; avoid double-wrapping |
| `$` content through bash | JS `${var}` / PS `$_` inline in Bash tool | Bash substitutes or errors ("bad substitution") | Write script to a temp file with the Write tool, execute the file |

## The two meta-rules

1. **Minimize parser layers.** `& exe args` from PowerShell = one layer. `cmd /c "..."` = two. `bash -c '...'` with inline code = two-plus. Every added layer is another chance for quote surgery. If you're wrapping a wrapper, stop and write a temp script file instead.
2. **Verify the argument arrived, don't assume.** For anything security- or state-relevant (passphrases, tokens, paths with spaces), test the *effect* immediately: can the key sign? does the file exist at the path the program saw? An argument that parsed differently than intended fails silently and surfaces minutes-to-days later as an unrelated-looking error.

## Environment notes

- PowerShell 7.3+ with `$PSNativeCommandArgumentPassing = 'Standard'` fixes many (not all) of these — empty strings and embedded quotes pass verbatim. Windows PowerShell 5.1 and `Legacy` mode re-quote heuristically; assume nothing.
- `ssh-keygen`, `openssl`, `git` on Windows are MSYS/native mixes — each has its own argv reconstruction. When an arg matters, test with `-y`-style read-back commands where the tool offers them.
