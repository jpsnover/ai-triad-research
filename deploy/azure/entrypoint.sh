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

echo "=== Entrypoint diagnostics ==="
echo "User: $(id)"
echo "DATA_LOCAL=$DATA_LOCAL (exists: $([ -d "$DATA_LOCAL" ] && echo yes || echo no), writable: $([ -w "$DATA_LOCAL" ] && echo yes || echo no))"
echo "DATA_REMOTE=$DATA_REMOTE (exists: $([ -d "$DATA_REMOTE" ] && echo yes || echo no))"

if [ -d "$DATA_REMOTE" ]; then
    FILE_COUNT=$(find "$DATA_REMOTE" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
    DIR_COUNT=$(find "$DATA_REMOTE" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    echo "DATA_REMOTE contents: $FILE_COUNT files, $DIR_COUNT dirs at top level"
    ls -la "$DATA_REMOTE/" 2>/dev/null | head -20
fi

if [ -d "$DATA_REMOTE" ] && [ "$(ls -A "$DATA_REMOTE" 2>/dev/null)" ]; then
    echo "Copying data from Azure Files to local storage..."
    cp -a "$DATA_REMOTE/." "$DATA_LOCAL/"
    SIZE=$(du -sh "$DATA_LOCAL" 2>/dev/null | cut -f1)
    echo "Data ready on local disk ($SIZE)"

    # Verify the taxonomy data the app needs
    if [ -d "$DATA_LOCAL/taxonomy/Origin" ]; then
        JSON_COUNT=$(find "$DATA_LOCAL/taxonomy/Origin" -name '*.json' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
        echo "Taxonomy check: $JSON_COUNT .json files in $DATA_LOCAL/taxonomy/Origin/"
    else
        echo "WARNING: $DATA_LOCAL/taxonomy/Origin/ does not exist after copy"
        echo "Available top-level dirs:"
        ls -d "$DATA_LOCAL"/*/ 2>/dev/null || echo "  (none)"
    fi
else
    echo "WARNING: $DATA_REMOTE is empty or missing — starting with empty data dir"
    echo "The app will show the Welcome screen. Seed data with: ./deploy.ps1 -SeedData"
    mkdir -p "$DATA_LOCAL"
fi

echo "=== Starting application ==="

# Hand off to the application
exec node dist/server/taxonomy-editor/src/server/server.js
