# AI Triad Research — Redistributable Release Plan

## Goal

Package the PowerShell tools and Electron viewer apps into a self-contained, installable distribution that researchers can install and use without cloning the repo or understanding the development setup.

## Components to Ship

### 1. PowerShell Module (`AITriad`)
- **What**: The `scripts/AITriad/` module + companion modules (`AIEnrich.psm1`, `DocConverters.psm1`)
- **Format**: PSGallery module package (`.nupkg`) — `Install-Module AITriad`
- **Includes**:
  - All Public/ and Private/ functions
  - Prompts/ directory (prompt templates)
  - Formats/ (PS formatting XML)
  - `ai-models.json` (bundled as module data)
  - Module manifest (`AITriad.psd1`) with version, dependencies, license
- **Dependencies**: PowerShell 7.0+, `pandoc` (optional, for HTML conversion), `pdftotext` (optional, for PDF extraction)
- **Installation**: `Install-Module AITriad -Scope CurrentUser`

### 2. Taxonomy Editor (Electron app)
- **What**: `taxonomy-editor/` — the main desktop app
- **Format**: Platform-specific installers via `electron-builder`
  - macOS: `.dmg` (universal binary, arm64 + x64)
  - Windows: `.msi` or NSIS installer
  - Linux: `.AppImage` and `.deb`
- **Includes**: Bundled Node.js runtime, Vite-built renderer, main process

### 3. POViewer, Summary Viewer, Edge Viewer (Electron apps)
- Same packaging as Taxonomy Editor
- Could be merged into Taxonomy Editor as additional tabs/views to reduce installer count

### 4. Data Package (optional, separate)
- `taxonomy/Origin/` — the taxonomy JSON files
- `ai-models.json` — model configuration
- `prompts/` — prompt templates
- This ships separately so researchers can update data without updating code

## Build Pipeline

### PowerShell Module

```
scripts/
├── AITriad/
│   ├── AITriad.psd1        ← bump version here
│   ├── AITriad.psm1
│   ├── Public/
│   ├── Private/
│   ├── Prompts/
│   └── Formats/
├── AIEnrich.psm1           ← bundle as nested module
└── DocConverters.psm1      ← bundle as nested module
```

**Steps**:
1. Create `build/` directory with flattened module layout
2. Copy AITriad module + companion modules
3. Bundle `ai-models.json` into module root
4. Run `Test-ModuleManifest` to validate
5. `Publish-Module -Path ./build/AITriad -NuGetApiKey $key -Repository PSGallery`

**First-run setup command**: `Register-AIBackend` — launches the key configuration UI

### Electron Apps

**Tooling**: `electron-builder` (already configured for dev, needs prod config)

**Steps**:
1. `npm run build` — Vite production build of renderer
2. `tsc -p tsconfig.main.json` — compile main process
3. `electron-builder --mac --win --linux` — produce platform installers
4. Sign macOS build with Developer ID certificate
5. Notarize macOS build with Apple
6. Sign Windows build with Authenticode certificate

**Configuration needed** (`electron-builder.yml`):
```yaml
appId: com.berkmanklein.ai-triad.taxonomy-editor
productName: AI Triad Taxonomy Editor
directories:
  output: release/
mac:
  target: [dmg, zip]
  category: public.app-category.education
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
win:
  target: [nsis, msi]
linux:
  target: [AppImage, deb]
  category: Education
```

### Installer Experience

**macOS**: Drag-to-Applications `.dmg` with background image, symlink to /Applications
**Windows**: NSIS "Next-Next-Finish" installer, Start Menu shortcut, optional desktop icon
**Linux**: AppImage (portable) + .deb (system install)

## First-Run Experience

1. User launches Taxonomy Editor
2. Settings dialog prompts for at least one API key (Gemini recommended — free tier)
3. "Refresh Models" auto-runs to populate available models
4. Sample taxonomy data is bundled so the app works immediately
5. Help dialog explains the workflow: ingest → summarize → explore → debate

## Version Strategy

- Semantic versioning: `MAJOR.MINOR.PATCH`
- PowerShell module and Electron apps share the same version number
- `TAXONOMY_VERSION` file in repo tracks data schema version (independent of code)
- GitHub Releases for each version with changelog and platform binaries

## CI/CD (GitHub Actions)

### Workflow: `release.yml`
Triggered by: pushing a git tag (`v1.0.0`)

```
jobs:
  build-ps-module:
    - Validate module manifest
    - Run Pester tests
    - Package .nupkg
    - Publish to PSGallery

  build-electron-mac:
    runs-on: macos-latest
    - npm ci
    - npm run build
    - electron-builder --mac
    - Notarize with Apple
    - Upload .dmg to GitHub Release

  build-electron-win:
    runs-on: windows-latest
    - npm ci
    - npm run build
    - electron-builder --win
    - Upload .msi to GitHub Release

  build-electron-linux:
    runs-on: ubuntu-latest
    - npm ci
    - npm run build
    - electron-builder --linux
    - Upload .AppImage and .deb to GitHub Release
```

## Open Questions

1. **Merge viewer apps into Taxonomy Editor?** — Currently 4 separate Electron apps. Shipping one app with tabs would simplify distribution. The Summary Viewer and Edge Viewer could become tabs in the Taxonomy Editor.

2. **Data bundling strategy** — Should the taxonomy data ship with the app (batteries-included) or require a separate `git clone` of the data repo? Bundling makes first-run easier; separate repo allows data updates without app updates.

3. **Auto-update** — Electron supports auto-update via `electron-updater`. Worth implementing for v1.1+.

4. **Code signing** — macOS requires notarization for non-App-Store distribution. Windows SmartScreen warns without Authenticode signing. Both require paid certificates.

5. **PSGallery account** — Need a NuGet API key for PSGallery publishing. Module name `AITriad` needs to be registered.

## Estimated Effort

| Task | Effort |
|------|--------|
| PowerShell module packaging + PSGallery publish | 1 day |
| electron-builder config for Taxonomy Editor | 1 day |
| macOS signing + notarization pipeline | 1 day |
| Windows signing pipeline | 0.5 day |
| GitHub Actions CI/CD workflow | 1 day |
| First-run experience + sample data | 0.5 day |
| Documentation + README for installers | 0.5 day |
| **Total** | **~5 days** |

## Next Action

Decide on the open questions above, then start with the PowerShell module packaging (lowest risk, highest value — lets anyone `Install-Module AITriad` immediately).
