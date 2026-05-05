# AI Triad Taxonomy Editor — Container Image
# Multi-stage build: compile TypeScript, then copy artifacts to lean runtime.
#
# Requires the base image: ghcr.io/jpsnover/ai-triad-base:latest
# (see deploy/azure/Dockerfile.base)

# ── Stage 1: Build ──
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# Native-module build deps for node-gyp (node-pty etc.)
# Builder stage is discarded — no impact on runtime image size.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first (Docker layer caching)
COPY taxonomy-editor/package.json taxonomy-editor/package-lock.json ./taxonomy-editor/
COPY lib/ ./lib/

# Install Node deps (including devDependencies for build)
WORKDIR /build/taxonomy-editor
RUN npm ci

# Copy source and build
WORKDIR /build
ARG CACHE_BUST=1
RUN echo "Cache bust: $CACHE_BUST"
COPY taxonomy-editor/package.json ./taxonomy-editor/
COPY taxonomy-editor/src/ ./taxonomy-editor/src/
COPY taxonomy-editor/tsconfig.json ./taxonomy-editor/
COPY taxonomy-editor/tsconfig.main.json ./taxonomy-editor/
COPY taxonomy-editor/tsconfig.server.json ./taxonomy-editor/
COPY taxonomy-editor/vite.config.ts ./taxonomy-editor/
COPY taxonomy-editor/scripts/ ./taxonomy-editor/scripts/
COPY ai-models.json ./
COPY .aitriad.json ./
COPY taxonomy/schemas/ ./taxonomy/schemas/

WORKDIR /build/taxonomy-editor
RUN npm run build:container

# ── Stage 2: Runtime ──
FROM ghcr.io/jpsnover/ai-triad-base:latest

VOLUME /data
ENV AI_TRIAD_DATA_ROOT=/data
ENV PORT=7862
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# ── Layers ordered by change frequency (least → most) ──

# 1. Node production dependencies (changes when package-lock.json changes)
COPY --chown=aitriad:aitriad taxonomy-editor/package.json taxonomy-editor/package-lock.json ./
RUN npm ci --omit=dev

# 2. Stable config and scripts (change occasionally)
COPY --chown=aitriad:aitriad ai-models.json ./
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

# 6. Entrypoint — copies Azure Files data to local ephemeral storage before starting
#    the app, eliminating SMB latency for all runtime reads.
COPY --chown=aitriad:aitriad deploy/azure/entrypoint.sh ./entrypoint.sh

USER aitriad

EXPOSE 7862

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s \
  CMD curl -f http://localhost:7862/health || exit 1

CMD ["sh", "entrypoint.sh"]
