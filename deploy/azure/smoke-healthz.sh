#!/usr/bin/env bash
# Pre-deploy runtime smoke: run a container image the way prod runs it and
# prove /healthz becomes ready. Catches "image builds + inits fully but never
# reports ready" — the failure class that took down prod in t/2047 (a base
# node bump broke the github-api data load → /healthz stayed 503 → crash-loop),
# which the build-only CI container gate passed green (t/2047 gap #1, t/1589).
#
# Usage:  IMAGE=<ref> GITHUB_TOKEN=<tok> deploy/azure/smoke-healthz.sh
#   IMAGE         required — the image ref (tag or @sha256 digest) to smoke.
#   GITHUB_TOKEN  required — public read is enough (jpsnover/ai-triad-data is
#                 public); the readiness gate needs the github-api fetch to
#                 succeed, which is exactly the path the t/2047 regression broke.
#
# Exit 0 = /healthz returned 200 within the window (healthy).
# Exit 1 = never became ready, or the container died (the crash-loop signature).
set -euo pipefail

IMAGE="${IMAGE:?set IMAGE to the image ref to smoke}"

# ── Gate tunables (co-located, per t/2048 Gate Co-Location) ─────────────────
# READY_TIMEOUT covers real cold start: onnx model is baked, so startup is
# app init + the github-api taxonomy fetch (public repo, a few MB). In the
# t/2047 incident the replica reached ~full init well before its 80s SIGTERM,
# so a healthy image is ready far inside this window; a never-ready replica
# (the crash-loop) exhausts it and fails. Bounded + deterministic — no flake.
READY_TIMEOUT="${READY_TIMEOUT:-180}"   # seconds
POLL_INTERVAL="${POLL_INTERVAL:-5}"      # seconds
PORT=7862
NAME="healthz-smoke-$$"
HEALTH_URL="http://localhost:${PORT}/healthz"

cleanup() {
  echo "── container logs (tail 120) ──"
  docker logs --tail 120 "$NAME" 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Smoking image: ${IMAGE}"
echo "Ready window: ${READY_TIMEOUT}s (poll every ${POLL_INTERVAL}s) against ${HEALTH_URL}"

# Prod-like runtime env. STORAGE_MODE=github-api forces the real data-load
# path (config.ts); GITHUB_REPO + GITHUB_TOKEN let it read the public data
# repo. AUTH_DISABLED keeps the smoke unauthenticated. This is what makes a
# good image reach 200 and a fetch-broken image stay 503.
docker run -d --name "$NAME" -p "${PORT}:${PORT}" \
  -e NODE_ENV=production \
  -e STORAGE_MODE=github-api \
  -e GITHUB_REPO="${GITHUB_REPO:-jpsnover/ai-triad-data}" \
  -e GITHUB_TOKEN="${GITHUB_TOKEN:?set GITHUB_TOKEN (public read is enough)}" \
  -e AI_TRIAD_DATA_ROOT=/tmp/taxonomy-cache \
  -e AUTH_DISABLED=1 \
  -e PORT="${PORT}" \
  "$IMAGE" >/dev/null

deadline=$(( SECONDS + READY_TIMEOUT ))
last=""
while (( SECONDS < deadline )); do
  # If the container exited, stop early — that's the crash, not a slow start.
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)" != "true" ]; then
    echo "::error::Container exited before becoming ready (crash signature)."
    exit 1
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || echo 000)
  if [ "$code" = "200" ]; then
    echo "READY: /healthz returned 200 after $(( SECONDS ))s."
    echo "── /health detail ──"
    curl -s --max-time 5 "http://localhost:${PORT}/health" || true
    exit 0
  fi
  if [ "$code" != "$last" ]; then
    echo "  t=$(( SECONDS ))s /healthz=${code}"
    last="$code"
  fi
  sleep "$POLL_INTERVAL"
done

echo "::error::/healthz never returned 200 within ${READY_TIMEOUT}s (last=${last}). Not ready — refusing to promote."
exit 1
