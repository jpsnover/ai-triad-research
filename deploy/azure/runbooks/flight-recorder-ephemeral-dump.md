# Flight Recorder: Ephemeral Dump Workaround

**Status:** Active until t/1350 ships (durable storage fix)

## Problem

Flight recorder merged dumps live on `/tmp/` inside the container. ACA replica recycles (including deploys) wipe `/tmp/`, destroying any undownloaded dumps.

## Workaround

Download merged dumps **immediately** after triggering — do not leave them for later retrieval.

```bash
# 1. Trigger a dump (via PowerShell cmdlet or admin UI)
#    The response includes a dumpId.

# 2. Download immediately
curl -H "Authorization: Bearer <token>" \
  "https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/api/flight-recorder/download-merged/<dumpId>" \
  -o "flight-recorder-<dumpId>.jsonl"

# Or via PowerShell:
Get-FlightRecorderDump -BaseUrl https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io
```

## Deploy-Day Procedure

Before dispatching `deploy-azure.yml`:

1. Check if any flight recorder dumps exist on the running replica
2. Download any needed dumps using the endpoint above
3. Proceed with deploy — the new revision will start with an empty `/tmp/`

## Resolution

t/1350 moves dumps to the durable Azure Files mount. Once deployed, this workaround is obsolete — delete this file.
