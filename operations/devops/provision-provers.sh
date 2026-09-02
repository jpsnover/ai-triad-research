#!/usr/bin/env bash
# provision-provers.sh — Install FOL/SMT provers for research tooling (t/3231)
#
# Provisions: Vampire (FOL), E Prover / eprover (FOL), Z3 (SMT)
# Target:     Linux (Ubuntu/Debian) or WSL2 on Windows dev.
#             Run with: bash operations/devops/provision-provers.sh
#
# Binary contract for the research harness (research/comp-linguist/tools/):
#   • Lookup order: $VAMPIRE_BIN > $(which vampire) — harness should follow this
#   • Lookup order: $EPROVER_BIN > $(which eprover)
#   • Lookup order: $Z3_BIN      > $(which z3)
#   All three must answer to --version (or -version for Vampire).
#
# Research-tool dependency ONLY — NOT a CI gate or production dependency.
# Any future CI gate routes through TL GV per claims-entity-fol-recommendations.md §risks.
#
# Versions pinned here; bump as needed:
VAMPIRE_TAG="v4.9"
Z3_TAG="z3-4.13.4"

set -euo pipefail

info()  { echo "[provision-provers] $*"; }
warn()  { echo "[provision-provers] WARN: $*" >&2; }
error() { echo "[provision-provers] ERROR: $*" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
    error "This script targets Linux/WSL2. On Windows, run inside WSL2: wsl bash operations/devops/provision-provers.sh"
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]]; then
    warn "Architecture $ARCH — Vampire prebuilt binary is x86_64 only. E and Z3 may still work."
fi

# ── Helper: detect existing install ──────────────────────────────────────────
already_installed() {
    local cmd="$1"
    if command -v "$cmd" &>/dev/null; then
        info "$cmd already on PATH: $(command -v "$cmd")"
        return 0
    fi
    return 1
}

# ── 1. Z3 ─────────────────────────────────────────────────────────────────────
info "--- Z3 (SMT solver) ---"
if ! already_installed z3; then
    if command -v apt-get &>/dev/null; then
        info "Installing z3 via apt..."
        sudo apt-get update -qq
        sudo apt-get install -y z3
    else
        # Fallback: download prebuilt binary from GitHub releases
        info "apt not available — downloading Z3 $Z3_TAG binary from GitHub..."
        TMP=$(mktemp -d)
        Z3_ASSET="${Z3_TAG}-x64-glibc-2.35.zip"
        Z3_URL="https://github.com/Z3Prover/z3/releases/download/${Z3_TAG}/${Z3_ASSET}"
        curl -fsSL -o "$TMP/z3.zip" "$Z3_URL"
        unzip -q "$TMP/z3.zip" -d "$TMP/z3"
        sudo install -m 755 "$TMP"/z3/*/bin/z3 /usr/local/bin/z3
        rm -rf "$TMP"
        info "Z3 installed to /usr/local/bin/z3"
    fi
fi
z3 --version

# ── 2. E Prover ───────────────────────────────────────────────────────────────
info "--- E Prover (eprover) ---"
if ! already_installed eprover; then
    if command -v apt-get &>/dev/null; then
        info "Installing eprover via apt..."
        sudo apt-get update -qq
        sudo apt-get install -y eprover
    else
        error "eprover not found and apt unavailable. Install manually from https://www.eprover.org/E-dist/DOWNLOADS.html and put on PATH."
    fi
fi
eprover --version | head -1

# ── 3. Vampire ────────────────────────────────────────────────────────────────
info "--- Vampire (ATP prover) ---"
if ! already_installed vampire; then
    if [[ "$ARCH" != "x86_64" ]]; then
        error "Vampire prebuilt binary is x86_64 only and $ARCH was detected. Build from source: https://github.com/vprover/vampire"
    fi
    info "Downloading Vampire $VAMPIRE_TAG static Linux binary from GitHub..."
    TMP=$(mktemp -d)
    # Vampire releases a static binary named 'vampire_z3_rel_<tag>_x86_64'
    # The exact asset name varies by release — fetch the release manifest to find it.
    RELEASE_URL="https://api.github.com/repos/vprover/vampire/releases/tags/${VAMPIRE_TAG}"
    ASSET_URL=$(curl -fsSL "$RELEASE_URL" \
        | python3 -c "import sys,json; assets=json.load(sys.stdin)['assets']; \
          match=[a['browser_download_url'] for a in assets if 'x86_64' in a['name'] and a['name'].endswith('.gz') or 'linux' in a['name'].lower()]; \
          print(match[0] if match else '')" 2>/dev/null || true)

    if [[ -z "$ASSET_URL" ]]; then
        # Fallback: try the most common naming pattern
        ASSET_URL="https://github.com/vprover/vampire/releases/download/${VAMPIRE_TAG}/vampire_z3_rel_${VAMPIRE_TAG#v}_x86_64.gz"
        warn "Could not auto-detect asset URL from release manifest; trying: $ASSET_URL"
    fi

    info "Downloading: $ASSET_URL"
    curl -fsSL -o "$TMP/vampire.gz" "$ASSET_URL"
    gunzip "$TMP/vampire.gz"
    sudo install -m 755 "$TMP/vampire" /usr/local/bin/vampire
    rm -rf "$TMP"
    info "Vampire installed to /usr/local/bin/vampire"
fi
vampire --version | head -1

# ── Summary ───────────────────────────────────────────────────────────────────
info ""
info "=== Prover provisioning complete ==="
info "z3:      $(command -v z3)"
info "eprover: $(command -v eprover)"
info "vampire: $(command -v vampire)"
info ""
info "Binary contract for the research harness:"
info "  \$VAMPIRE_BIN (env) > \$(which vampire)"
info "  \$EPROVER_BIN (env) > \$(which eprover)"
info "  \$Z3_BIN      (env) > \$(which z3)"
info ""
info "On Windows dev: run this script inside WSL2 (wsl bash operations/devops/provision-provers.sh)"
