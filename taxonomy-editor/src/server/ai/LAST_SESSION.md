**Date:** 2026-07-01
**Working on:** t/1262 — migrate server AI endpoints to UsageID registry; t/1061 — free tier token budget fix
**Status:** both complete (t/1061 commit handled by TL; t/1262 commit a2ee118a)
**Key context:** callByUsage() from lib/ai-client not used directly — server needs callWithKeyRotation() multi-key infra, so we use getUsage()+renderTemplate() for config and delegate to existing generateText()
**Next:** no unblocked tickets; check queue on next session start
