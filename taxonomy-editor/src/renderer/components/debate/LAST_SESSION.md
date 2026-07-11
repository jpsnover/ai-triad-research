**Date:** 2026-07-11
**Working on:** t/1479 (done), then two ping-driven tasks: t/1511 ExternalEmbed adoption + t/1520 iPad window.open cookie loss.
**Status:** All committed on local main, not pushed (awaiting TL sync). t/1479 transitioned Done. t/1511 + t/1520 are Taxonomy Editor tickets — my scope's parts are done.
**Key context:** Commits — `ec5aabac` (t/1479 test), `e12ec35c` (t/1511: DebateSourceViewer + SituationsTab now use `<ExternalEmbed>`), `23e59419` (t/1520: DebateTab community Open-in-Window hash-navigates on mobile). t/1520 detection is an inlined copy of web-bridge `isMobilePlatform()` — flagged Taxonomy Editor (p/101#18) to export a shared version so I can dedupe.
**Next:** If TL asks for a push, these 3 + earlier `2d7685c7` are unpushed. If Taxonomy Editor exports a shared isMobilePlatform, swap DebateTab's inline copy to it.
