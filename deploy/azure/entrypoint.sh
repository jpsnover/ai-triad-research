#!/bin/sh
set -e

# Copy taxonomy data from Azure Files (SMB) to local ephemeral storage.
# Azure Files has ~5-25ms latency per I/O op over SMB; local disk is sub-ms.
#
# Strategy: start the app immediately (passes health probe), then copy data
# in the background. The app serves from /data which starts empty, and the
# background copy populates it. The app's welcome screen shows briefly,
# then data becomes available on the fast local disk.

DATA_LOCAL="/data"
DATA_REMOTE="/data-persistent"
COPY_DIRS="taxonomy sources summaries debates conflicts chats dictionary flight-recorder harvests"

mkdir -p "$DATA_LOCAL"

# Start the background copy
(
    if [ -d "$DATA_REMOTE" ] && [ "$(ls -A "$DATA_REMOTE" 2>/dev/null)" ]; then
        echo "[bg-copy] Starting data copy from Azure Files..."

        # Copy essential directories
        for dir in $COPY_DIRS; do
            if [ -d "$DATA_REMOTE/$dir" ]; then
                cp -a "$DATA_REMOTE/$dir" "$DATA_LOCAL/$dir"
                echo "[bg-copy] Copied $dir"
            fi
        done

        # Copy top-level files (config, queue files, etc.)
        find "$DATA_REMOTE" -maxdepth 1 -type f -exec cp {} "$DATA_LOCAL/" \;

        # If git sync is enabled, copy .git too
        if [ "$GIT_SYNC_ENABLED" = "1" ] && [ -d "$DATA_REMOTE/.git" ]; then
            echo "[bg-copy] Git sync enabled — copying .git..."
            cp -a "$DATA_REMOTE/.git" "$DATA_LOCAL/.git"
        fi

        SIZE=$(du -sh "$DATA_LOCAL" 2>/dev/null | cut -f1)
        echo "[bg-copy] Done ($SIZE on local disk)"
    else
        echo "[bg-copy] WARNING: $DATA_REMOTE is empty or missing"
    fi
) &

# Start the app immediately (health probe passes right away)
echo "=== Starting application ==="
exec node dist/server/taxonomy-editor/src/server/server.js
