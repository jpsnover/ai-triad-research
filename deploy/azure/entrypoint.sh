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

if [ -d "$DATA_REMOTE" ] && [ "$(ls -A "$DATA_REMOTE" 2>/dev/null)" ]; then
    echo "Copying data from Azure Files to local storage..."
    cp -a "$DATA_REMOTE/." "$DATA_LOCAL/"
    SIZE=$(du -sh "$DATA_LOCAL" 2>/dev/null | cut -f1)
    echo "Data ready on local disk ($SIZE)"
else
    echo "Warning: $DATA_REMOTE is empty or missing — starting with empty data dir"
    mkdir -p "$DATA_LOCAL"
fi

# Hand off to the application
exec node dist/server/taxonomy-editor/src/server/server.js
