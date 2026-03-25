# AI Triad Research — Redistributable Release Plan

## Goal

Package the PowerShell tools and Electron viewer apps into a self-contained, installable distribution that researchers can install and use without cloning the code repo or understanding the development setup.

## Architecture (as of March 2026)

```
Code Repo (ai-triad-research)          ~10 MB
├── scripts/AITriad/                    PowerShell module (40+ cmdlets)
├── scripts/AIEnrich.psm1              AI API abstraction
├── scripts/DocConverters.psm1         Document conversion
├── taxonomy-editor/                    Main desktop app (includes Edge Browser)
├── poviewer/                          POV analysis viewer
├── summary-viewer/                    Summary browser
├── ai-models.json                     Model configuration (single source of truth)
├── .aitriad.json                      Data path configuration
└── taxonomy/schemas/                  JSON validation schemas

Data Repo (ai-triad-data)              ~410 MB
├── taxonomy/Origin/                   4 POV taxonomies + edges + embeddings
├── sources/                           134 ingested documents
├── summaries/                         92 POV summaries
├── conflicts/                         713 factual conflicts
├── debates/                           Debate sessions
├── .summarise-queue.json              Summary queue
└── TAXONOMY_VERSION                   Schema version
```

**Key design decisions already implemented:**
- Edge Viewer retired — merged into Taxonomy Editor as toolbar panel
- Data separated into `ai-triad-data` repo with `.aitriad.json` path config
- `Install-AITriadData` cmdlet handles cloning/updating the data repo
- Taxonomy Editor checks for data updates on startup (if online)
- `AIEnrich.psm1` reads model registry from `ai-models.json`
- Multi-backend AI support (Gemini, Claude, Groq) with model discovery

## Components to Ship

### 1. PowerShell Module (`AITriad`)

**Format**: PSGallery module package — `Install-Module AITriad`

**Includes**:
- All Public/ and Private/ functions (including `Install-AITriadData`, `Resolve-DataPath`)
- Prompts/ directory (prompt templates)
- Formats/ (PS formatting XML)
- `ai-models.json` (bundled as module data)
- `AIEnrich.psm1` and `DocConverters.psm1` (bundled as nested modules)
- Default `.aitriad.json` template
- Module manifest (`AITriad.psd1`) with version, dependencies, license

**Dependencies**: PowerShell 7.0+, git (for `Install-AITriadData`), `pandoc` (optional), `pdftotext` (optional)

**First-run flow**:
```powershell
Install-Module AITriad -Scope CurrentUser
Import-Module AITriad
Install-AITriadData          # Clones ai-triad-data repo
Register-AIBackend           # Configure API keys via browser UI
Test-Dependencies            # Verify setup
```

**Packaging considerations**:
- Module needs to locate `ai-models.json` relative to its install path, not `$script:RepoRoot`
- `Resolve-DataPath.ps1` must handle PSGallery installation where there is no `.aitriad.json` at a repo root — fall back to `$HOME/.aitriad/data` or prompt user via `Install-AITriadData`
- The default `.aitriad.json` bundled in the module should use `$HOME/.aitriad/data` as `data_root` for non-dev installs

### 2. Taxonomy Editor (Electron app)

**What**: The main desktop app — taxonomy editing, debates, edge browsing, analysis

**Format**: Platform-specific installers via `electron-builder`
- macOS: `.dmg` (universal binary, arm64 + x64)
- Windows: `.msi` or NSIS installer
- Linux: `.AppImage` and `.deb`

**Includes**: Bundled Node.js runtime, Vite-built renderer, main process

**Runtime data resolution**:
- Packaged app reads `.aitriad.json` from `PROJECT_ROOT` (the app's resources directory)
- Default config for packaged builds: `data_root` points to `$HOME/.aitriad/data`
- Startup data update checker (`dataUpdateChecker.ts`) fetches from GitHub if online
- First-run: if data dir doesn't exist, show a setup dialog offering to clone it

### 3. POViewer and Summary Viewer

**Decision needed**: Merge into Taxonomy Editor or ship separately?

**Recommendation**: Merge both into the Taxonomy Editor as toolbar panels (like Edge Browser was merged). This:
- Reduces installer count from 3 to 1
- Shares the data path resolution infrastructure
- Eliminates the need for inter-app focus-node communication (HTTP server)
- Simplifies the update story

**If shipped separately**: Same packaging as Taxonomy Editor, same `.aitriad.json` resolution.

### 4. Data Package

**Already implemented** as `ai-triad-data` GitHub repo. No separate packaging needed — users clone it via `Install-AITriadData` or the Taxonomy Editor prompts them on first run.

For offline distribution or workshops, the data repo can be zipped and distributed as a `.zip` / `.tar.gz` archive.

## Build Pipeline

### PowerShell Module

```
build/AITriad/
├── AITriad.psd1              ← version bumped
├── AITriad.psm1
├── Public/
├── Private/
│   ├── Resolve-DataPath.ps1  ← data path resolution
│   ├── AIModelValidation.ps1
│   └── ...
├── Prompts/
├── Formats/
├── AIEnrich.psm1             ← nested module
├── DocConverters.psm1        ← nested module
├── ai-models.json            ← model config
└── .aitriad.json.template    ← default config for non-dev installs
```

**Steps**:
1. Create `build/AITriad/` with flattened module layout
2. Copy module files + companion modules + `ai-models.json`
3. Update `$script:RepoRoot` resolution in psm1 to handle PSGallery install path
4. Create `.aitriad.json.template` with `data_root: "$HOME/.aitriad/data"`
5. Run `Test-ModuleManifest` to validate
6. `Publish-Module -Path ./build/AITriad -NuGetApiKey $key -Repository PSGallery`

**First-run setup**: `Install-AITriadData` clones data repo to `~/.aitriad/data/`

### Electron Apps

**Tooling**: `electron-builder`

**Steps**:
1. `npm run build` — Vite production build of renderer
2. `tsc -p tsconfig.main.json` — compile main process
3. Bundle `.aitriad.json` with packaged-app defaults into app resources
4. `electron-builder --mac --win --linux` — produce platform installers
5. Sign and notarize (see below)

**Configuration** (`electron-builder.yml`):
```yaml
appId: com.berkmanklein.ai-triad.taxonomy-editor
productName: AI Triad Taxonomy Editor
directories:
  output: release/
files:
  - dist/**/*
  - "!node_modules"
extraResources:
  - from: "../ai-models.json"
    to: "ai-models.json"
  - from: "../.aitriad.json.packaged"
    to: ".aitriad.json"
  - from: "../taxonomy/schemas/"
    to: "taxonomy/schemas/"
mac:
  target: [dmg, zip]
  category: public.app-category.education
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
win:
  target: [nsis]
linux:
  target: [AppImage, deb]
  category: Education
```

### Installer Experience

**macOS**: Drag-to-Applications `.dmg`
**Windows**: NSIS "Next-Next-Finish" installer, Start Menu shortcut
**Linux**: AppImage (portable) + .deb (system install)

## First-Run Experience

### Taxonomy Editor (Electron)

1. User launches app
2. App checks for data at configured path (`~/.aitriad/data/` for packaged builds)
3. **If no data found**: Show first-run dialog:
   - "AI Triad needs research data to operate. Download now? (~410 MB)"
   - [Download] — runs `git clone` to `~/.aitriad/data/`
   - [Browse...] — point to existing data directory
   - [Skip] — app opens with empty state
4. Settings dialog prompts for API key (Gemini recommended — free tier)
5. "Refresh Models" auto-runs to populate available models
6. On subsequent launches: data update check runs silently in background

### PowerShell Module (PSGallery)

1. `Install-Module AITriad` — installs from PSGallery
2. `Import-Module AITriad` — loads module
3. `Install-AITriadData` — clones data repo to `~/.aitriad/data/`
4. `Register-AIBackend` — configure API keys
5. `Test-Dependencies` — verify everything works

## Version Strategy

- Semantic versioning: `MAJOR.MINOR.PATCH`
- PowerShell module and Electron apps share the same version number
- Data repo has its own version (independent release cycle)
- `TAXONOMY_VERSION` in data repo tracks data schema version
- GitHub Releases for each version with changelog and platform binaries

## CI/CD (GitHub Actions)

### Workflow: `release.yml`
Triggered by: pushing a git tag (`v1.0.0`)

```yaml
jobs:
  build-ps-module:
    runs-on: ubuntu-latest
    steps:
      - Validate module manifest
      - Run Pester tests
      - Package module directory
      - Publish to PSGallery

  build-electron-mac:
    runs-on: macos-latest
    steps:
      - npm ci
      - npm run build
      - Create .aitriad.json.packaged with default paths
      - electron-builder --mac --universal
      - Notarize with Apple (apple-id, team-id, app-specific-password)
      - Upload .dmg to GitHub Release

  build-electron-win:
    runs-on: windows-latest
    steps:
      - npm ci
      - npm run build
      - Create .aitriad.json.packaged
      - electron-builder --win
      - Sign with Authenticode (if cert available)
      - Upload .exe to GitHub Release

  build-electron-linux:
    runs-on: ubuntu-latest
    steps:
      - npm ci
      - npm run build
      - Create .aitriad.json.packaged
      - electron-builder --linux
      - Upload .AppImage and .deb to GitHub Release
```

## Remaining Work

### Must-have for v1.0

| Task | Effort | Status |
|------|--------|--------|
| Merge POViewer into Taxonomy Editor | 1 day | Not started |
| Merge Summary Viewer into Taxonomy Editor | 1 day | Not started |
| PowerShell module: handle PSGallery install paths | 0.5 day | Not started |
| PowerShell module: `.aitriad.json.template` for non-dev | 0.5 day | Not started |
| Electron: first-run data download dialog | 0.5 day | Not started |
| Electron: `.aitriad.json.packaged` with `~/.aitriad/data` | 0.5 day | Not started |
| `electron-builder.yml` configuration | 0.5 day | Not started |
| Pester tests for core cmdlets | 1 day | Not started |
| GitHub Actions `release.yml` | 1 day | Not started |
| PSGallery account + module name registration | 0.5 day | Not started |
| **Total** | **~7 days** | |

### Nice-to-have for v1.1

| Task | Effort |
|------|--------|
| macOS code signing + notarization | 1 day |
| Windows Authenticode signing | 0.5 day |
| Auto-update via `electron-updater` | 1 day |
| Offline data bundle (`.zip` distribution) | 0.5 day |

## Decisions Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| Merge viewer apps? | Yes — merge all into Taxonomy Editor | One installer, shared infrastructure |
| Data bundling? | Separate repo with auto-update | Already implemented; `Install-AITriadData` for CLI, startup checker for Electron |
| Edge Viewer? | Retired — merged as Edge Browser toolbar panel | Done in this session |
| Data paths? | `.aitriad.json` with env var override | Phase 1-4 complete |
| Model config? | `ai-models.json` with Refresh Models discovery | Done |

## Decisions Remaining

1. **Code signing certificates** — macOS notarization requires Apple Developer ID ($99/yr). Windows Authenticode requires a code signing cert ($200-400/yr). Defer to v1.1?

2. **PSGallery module name** — Is `AITriad` available? Fallback: `AITriadResearch`.

3. **Default data location for packaged installs** — `~/.aitriad/data/` on all platforms? Or platform-specific (`%APPDATA%\AITriad\data` on Windows, `~/Library/Application Support/AITriad/data` on macOS)?

4. **Minimum data for first-run** — Should the Electron app bundle a minimal taxonomy snapshot (~1 MB) so it's usable without cloning 410 MB? Users could then download the full dataset later.
