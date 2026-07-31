# syntax=docker/dockerfile:1.7

# AI Triad Taxonomy Editor — Container Image
# Multi-stage build: compile TypeScript, then copy artifacts to lean runtime.
#
# Requires the base image: ghcr.io/jpsnover/ai-triad-base:<date-tag>
# (see deploy/azure/Dockerfile.base)

# ── Stage 1: Build ──
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# Native-module build deps for node-gyp (node-pty etc.)
# Builder stage is discarded — no impact on runtime image size.
# hadolint ignore=DL3008
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++

# Copy dependency manifests first (Docker layer caching)
COPY taxonomy-editor/package.json taxonomy-editor/package-lock.json ./taxonomy-editor/
COPY lib/ ./lib/

# Install Node deps (including devDependencies for build)
WORKDIR /build/taxonomy-editor
RUN --mount=type=cache,target=/root/.npm npm ci

# Install shared-lib deps too (t/2035): lib/ is a self-contained package with its
# own package.json, and the sanitizer core's renderer-parity decoders must resolve
# from lib/node_modules during build:server (tsc). Mirrors the test-electron CI job
# (ci.yml "Install shared lib dependencies"). Without this, build:container's tsc
# fails TS2307 on the lib/ core's decoder imports.
WORKDIR /build/lib
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source and build
WORKDIR /build
COPY taxonomy-editor/src/ ./taxonomy-editor/src/
COPY taxonomy-editor/tsconfig.json ./taxonomy-editor/
COPY taxonomy-editor/tsconfig.main.json ./taxonomy-editor/
COPY taxonomy-editor/tsconfig.server.json ./taxonomy-editor/
COPY taxonomy-editor/vite.config.ts ./taxonomy-editor/
COPY taxonomy-editor/scripts/ ./taxonomy-editor/scripts/
COPY ai-models.json ./
COPY ai-usages.json ./
COPY .aitriad.json ./
COPY CHANGELOG.md ./
COPY taxonomy/schemas/ ./taxonomy/schemas/

WORKDIR /build/taxonomy-editor
RUN npm run build:container

# ── Stage 2: Production dependencies (with build tools for native modules) ──
FROM node:22-bookworm-slim AS prod-deps

# node-pty requires make/g++/python3 for compilation when prebuilds
# are unavailable. The runtime base image is intentionally slim (no
# build tools), so compile here and copy the result.
# hadolint ignore=DL3008
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++

WORKDIR /deps
COPY taxonomy-editor/package.json taxonomy-editor/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ── Stage 3: Runtime ──
# Base HELD at :2026-07-20 — reverts Dependabot bump 0b33fc18 (:2026-07-20 → :2026-07-30).
# The :2026-07-30 base broke the container readiness path: the app inits fully, then
# readiness returns 503 → SIGTERM → crash-loop → P1 prod outage (t/2047). :2026-07-20 is
# the known-good gemini base now serving prod. Do NOT bump until Docker fixes the base
# regression AND a docker-run + GET /health pre-deploy smoke gate exists (t/2047 gaps #1/#4).
FROM ghcr.io/jpsnover/ai-triad-base:2026-07-20 AS runtime

LABEL org.opencontainers.image.source="https://github.com/jpsnover/ai-triad-research"
LABEL org.opencontainers.image.description="AI Triad Taxonomy Editor"
LABEL org.opencontainers.image.licenses="MIT"

# Cache dir created at runtime by the app (GitHubAPIBackend).
# TAXONOMY_CACHE_DIR MUST match AI_TRIAD_DATA_ROOT (t/2061): config.ts's cacheDir
# defaults to ~/.cache/taxonomy (=/root/.cache/taxonomy in-container) when unset,
# while getDataRoot() uses AI_TRIAD_DATA_ROOT — the mismatch makes toRepoPath()'s
# startsWith(cacheDir) check fail, so isDataAvailable() is always false → /healthz
# 503 → crash-loop (the P1 latent readiness bug, t/2047). Keep these two in sync.
ENV AI_TRIAD_DATA_ROOT=/tmp/taxonomy-cache
ENV TAXONOMY_CACHE_DIR=/tmp/taxonomy-cache
ENV PORT=7862
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# ── Layers ordered by change frequency (least → most) ──

# 1. Node production dependencies (pre-compiled in prod-deps stage)
COPY --chown=aitriad:aitriad taxonomy-editor/package.json taxonomy-editor/package-lock.json ./
COPY --from=prod-deps --chown=aitriad:aitriad /deps/node_modules ./node_modules/

# 2. Stable config and scripts (change occasionally)
COPY --chown=aitriad:aitriad ai-models.json ./
COPY --chown=aitriad:aitriad ai-usages.json ./
COPY --chown=aitriad:aitriad .aitriad.json ./
COPY --chown=aitriad:aitriad taxonomy/schemas/ ./taxonomy/schemas/
COPY --chown=aitriad:aitriad scripts/ ./scripts/

# 3. Built artifacts (change on every code edit — LAST for fastest rebuilds)
# tsc outputs to dist/server/{taxonomy-editor/src/server/,lib/} due to rootDir=../
# Keep the full structure so compiled require() paths work, then symlink
# renderer and package.json where __dirname-relative lookups expect them.
COPY --chown=aitriad:aitriad --from=builder /build/taxonomy-editor/dist/server/ ./dist/server/
COPY --chown=aitriad:aitriad --from=builder /build/taxonomy-editor/dist/renderer/ ./dist/renderer/
RUN ln -s /app/dist/renderer /app/dist/server/taxonomy-editor/src/renderer \
 && ln -s /app/package.json /app/dist/server/taxonomy-editor/src/package.json

# 4. Third-party license notices (generated during build)
COPY --chown=aitriad:aitriad --from=builder /build/taxonomy-editor/THIRD-PARTY-NOTICES.txt ./taxonomy-editor/THIRD-PARTY-NOTICES.txt

# 5. PTY broker script (Python, not compiled by tsc — copy to where config.ts expects it)
COPY --chown=aitriad:aitriad taxonomy-editor/src/main/pty-broker.py ./src/main/pty-broker.py

# 6. Fallback taxonomy snapshot — baked last-known-good data for GitHub outages.
#    CI fetches from ai-triad-data HEAD; changes on every build — LAST layer.
#    Contains snapshot-meta.json with generation timestamp for stale-data banner.
#    For local builds: mkdir -p taxonomy-snapshot && echo '{}' > taxonomy-snapshot/snapshot-meta.json
COPY --chown=aitriad:aitriad taxonomy-snapshot/ ./fallback-data/

USER aitriad

EXPOSE 7862

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s \
  CMD curl -f http://localhost:7862/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server/taxonomy-editor/src/server/server.js"]
