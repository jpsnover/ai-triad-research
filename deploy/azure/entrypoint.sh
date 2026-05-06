#!/bin/sh
set -e

# Copy taxonomy data from Azure Files (SMB) to local ephemeral storage.
# Azure Files has ~5-25ms latency per I/O op over SMB; local disk is sub-ms.
#
# Strategy: start the app immediately (passes health probe), then copy data
# in the background. The app serves from /data which starts empty, and the
# background copy populates it. The app's welcome screen shows briefly,
# then data becomes available on the fast local disk.
#
# Progress is written to /tmp/copy-status.json for the /status endpoint.

DATA_LOCAL="/data"
DATA_REMOTE="/data-persistent"
STATUS_FILE="/tmp/copy-status.json"
COPY_DIRS="taxonomy sources summaries debates conflicts chats dictionary flight-recorder harvests"
TOTAL_DIRS=$(echo $COPY_DIRS | wc -w | tr -d ' ')

log() { echo "[entrypoint] $(date -u +%H:%M:%S) $*"; }

# ── Environment snapshot ──
log "=== Container Start ==="
log "Image: ${DEPLOY_TAG:-unknown} (sha: ${DEPLOY_SHA:-unknown})"
log "User: $(id -un) ($(id -u))"
log "NODE_ENV=${NODE_ENV:-unset}"
log "GIT_SYNC_ENABLED=${GIT_SYNC_ENABLED:-unset}"
log "AUTH_DISABLED=${AUTH_DISABLED:-unset}, AUTH_OPTIONAL=${AUTH_OPTIONAL:-unset}"

if [ -d "$DATA_REMOTE" ]; then
    REMOTE_FILES=$(find "$DATA_REMOTE" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
    REMOTE_DIRS=$(find "$DATA_REMOTE" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    log "$DATA_REMOTE: mounted, ${REMOTE_FILES} files, ${REMOTE_DIRS} dirs"
else
    log "$DATA_REMOTE: NOT MOUNTED"
fi
log "$DATA_LOCAL: exists=$([ -d "$DATA_LOCAL" ] && echo yes || echo no), writable=$([ -w "$DATA_LOCAL" ] && echo yes || echo no)"

mkdir -p "$DATA_LOCAL"

# ── Background data copy ──
(
    write_status() {
        echo "{\"state\":\"$1\",\"dir\":\"$2\",\"copied\":$3,\"total\":$TOTAL_DIRS,\"elapsed_s\":$4}" > "$STATUS_FILE"
    }

    COPY_START=$(date +%s)
    COPIED=0
    write_status "starting" "" 0 0

    if [ -d "$DATA_REMOTE" ] && [ "$(ls -A "$DATA_REMOTE" 2>/dev/null)" ]; then
        log "Background copy starting ($TOTAL_DIRS directories)..."

        for dir in $COPY_DIRS; do
            if [ -d "$DATA_REMOTE/$dir" ]; then
                DIR_START=$(date +%s)
                write_status "copying" "$dir" $COPIED $(($(date +%s) - COPY_START))
                cp -a "$DATA_REMOTE/$dir" "$DATA_LOCAL/$dir" 2>/dev/null || true
                DIR_END=$(date +%s)
                COPIED=$((COPIED + 1))
                DIR_SIZE=$(du -sh "$DATA_LOCAL/$dir" 2>/dev/null | cut -f1)
                log "Copied $dir ($DIR_SIZE, $((DIR_END - DIR_START))s) [$COPIED/$TOTAL_DIRS]"
            else
                COPIED=$((COPIED + 1))
                log "Skipped $dir (not present) [$COPIED/$TOTAL_DIRS]"
            fi
        done

        # Copy top-level files (config, queue files, etc.)
        log "Copying top-level files..."
        find "$DATA_REMOTE" -maxdepth 1 -type f -exec cp {} "$DATA_LOCAL/" \; 2>/dev/null || true

        # If git sync is enabled, copy .git too
        if [ "$GIT_SYNC_ENABLED" = "1" ] && [ -d "$DATA_REMOTE/.git" ]; then
            GIT_START=$(date +%s)
            write_status "copying" ".git" $COPIED $(($(date +%s) - COPY_START))
            log "Git sync enabled — copying .git..."
            cp -a "$DATA_REMOTE/.git" "$DATA_LOCAL/.git" 2>/dev/null || true
            GIT_END=$(date +%s)
            GIT_SIZE=$(du -sh "$DATA_LOCAL/.git" 2>/dev/null | cut -f1)
            log "Copied .git ($GIT_SIZE, $((GIT_END - GIT_START))s)"
        fi

        COPY_END=$(date +%s)
        TOTAL_SIZE=$(du -sh "$DATA_LOCAL" 2>/dev/null | cut -f1)
        ELAPSED=$((COPY_END - COPY_START))
        write_status "complete" "" $COPIED $ELAPSED
        log "=== Copy complete: $TOTAL_SIZE on local disk in ${ELAPSED}s ==="
    else
        write_status "empty" "" 0 0
        log "WARNING: $DATA_REMOTE is empty or missing — no data to copy"
    fi
) &

# ── Start app immediately (health probe passes right away) ──
log "Starting Node.js server..."
exec node dist/server/taxonomy-editor/src/server/server.js
