---
name: Release plan decisions (March 2026)
description: Key decisions for the v1.0 redistributable release
type: project
---

Release decisions made 2026-03-25:

1. **Code signing**: Deferred to v1.1. Ship unsigned for v1.0.
2. **PSGallery module name**: `AITriad`
3. **Default data location**: Platform-specific paths:
   - macOS: `~/Library/Application Support/AITriad/data`
   - Windows: `%LOCALAPPDATA%\AITriad\data`
   - Linux: `~/.local/share/aitriad/data`
4. **Bundle minimal taxonomy snapshot**: Yes — bundle taxonomy JSONs (~1 MB) in the Electron app so it works immediately without cloning 410 MB. Full data download is prompted but optional.

**Why:** Platform-specific paths follow OS conventions (XDG on Linux, Library on macOS, LocalAppData on Windows). This ensures the data directory is in a standard location that backup tools and OS cleanup utilities expect.

**How to apply:** Use these decisions when implementing the PSGallery packaging, Electron first-run dialog, and `.aitriad.json.packaged` defaults.
