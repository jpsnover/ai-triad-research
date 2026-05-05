#!/bin/sh
set -e

# Copy taxonomy data from Azure Files (SMB) to local ephemeral storage.
# Azure Files has ~5-25ms latency per I/O op over SMB; local disk is sub-ms.
# This eliminates SMB latency for all runtime reads (taxonomy, debates, diagnostics).
#
# Persistence model:
#   - Git sync enabled: writes commit+push to GitHub (source of truth)
#   - Git sync disabled: data is read-only (API keys live in Key Vault, not filesystem)
#   - On container restart: fresh copy from Azure Files, then git pull for latest

DATA_LOCAL="/data"
DATA_REMOTE="/data-persistent"

# Directories the app actually needs at runtime. Skip .git (can be 100s of MB),
# research artifacts, and migration manifests to keep the copy fast (<30s).
COPY_DIRS="taxonomy sources summaries debates conflicts chats dictionary flight-recorder harvests"

echo "=== Entrypoint: copying data to local disk ==="

if [ -d "$DATA_REMOTE" ] && [ "$(ls -A "$DATA_REMOTE" 2>/dev/null)" ]; then
    mkdir -p "$DATA_LOCAL"

    # Copy essential directories
    for dir in $COPY_DIRS; do
        if [ -d "$DATA_REMOTE/$dir" ]; then
            cp -a "$DATA_REMOTE/$dir" "$DATA_LOCAL/$dir"
        fi
    done

    # Copy top-level files (config, queue files, etc.) — small and fast
    find "$DATA_REMOTE" -maxdepth 1 -type f -exec cp {} "$DATA_LOCAL/" \;

    # If git sync is enabled, copy .git too (needed for commits/push)
    if [ "$GIT_SYNC_ENABLED" = "1" ] && [ -d "$DATA_REMOTE/.git" ]; then
        echo "Git sync enabled — copying .git directory..."
        cp -a "$DATA_REMOTE/.git" "$DATA_LOCAL/.git"
    fi

    SIZE=$(du -sh "$DATA_LOCAL" 2>/dev/null | cut -f1)
    echo "Data ready on local disk ($SIZE)"
else
    echo "WARNING: $DATA_REMOTE is empty or missing — starting with empty data dir"
    mkdir -p "$DATA_LOCAL"
fi

echo "=== Starting application ==="
exec node dist/server/taxonomy-editor/src/server/server.js
