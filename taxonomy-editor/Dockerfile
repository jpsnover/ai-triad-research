# AI Triad Taxonomy Editor — Container Image
# Multi-stage build: compile TypeScript, then copy artifacts to lean runtime.

# ── Stage 1: Build ──
FROM node:22.16-bookworm-slim AS builder

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
COPY taxonomy-editor/src/ ./taxonomy-editor/src/
COPY taxonomy-editor/tsconfig.json ./taxonomy-editor/
COPY taxonomy-editor/tsconfig.main.json ./taxonomy-editor/
COPY taxonomy-editor/tsconfig.server.json ./taxonomy-editor/
COPY taxonomy-editor/vite.config.ts ./taxonomy-editor/
COPY ai-models.json ./
COPY .aitriad.json ./
COPY taxonomy/schemas/ ./taxonomy/schemas/

WORKDIR /build/taxonomy-editor
RUN npm run build:container

# ── Stage 2: Runtime ──
FROM node:22.16-bookworm-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    pandoc \
    python3 \
    python3-pip \
    python3-venv \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# PowerShell 7 — install via tar.gz (works on both amd64 and arm64)
ARG PS_VERSION=7.5.1
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then PS_ARCH="x64"; elif [ "$ARCH" = "arm64" ]; then PS_ARCH="arm64"; else echo "Unsupported arch: $ARCH" && exit 1; fi \
    && curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${PS_VERSION}/powershell-${PS_VERSION}-linux-${PS_ARCH}.tar.gz" -o /tmp/ps.tar.gz \
    && mkdir -p /opt/microsoft/powershell/7 \
    && tar xzf /tmp/ps.tar.gz -C /opt/microsoft/powershell/7 \
    && rm /tmp/ps.tar.gz \
    && chmod +x /opt/microsoft/powershell/7/pwsh \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/local/bin/pwsh \
    && apt-get update && apt-get install -y --no-install-recommends libicu72 \
    && rm -rf /var/lib/apt/lists/*

# Python ML environment (isolated venv, CPU-only PyTorch to reduce image size)
RUN python3 -m venv /opt/ml-env
ENV PATH="/opt/ml-env/bin:$PATH"
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu

# Install all Python dependencies from requirements.txt
COPY scripts/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Pre-download embedding model for fast first run
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Application code
WORKDIR /app

# Production Node dependencies only
COPY taxonomy-editor/package.json taxonomy-editor/package-lock.json ./
RUN npm ci --omit=dev

# Built artifacts from stage 1
COPY --from=builder /build/taxonomy-editor/dist/server/ ./dist/server/
COPY --from=builder /build/taxonomy-editor/dist/renderer/ ./dist/renderer/

# Scripts and config
COPY scripts/ ./scripts/
COPY taxonomy-editor/authorized-users.json ./
COPY ai-models.json ./
COPY .aitriad.json ./
COPY taxonomy/schemas/ ./taxonomy/schemas/

# Data volume
VOLUME /data
ENV AI_TRIAD_DATA_ROOT=/data
ENV PORT=7862
# Prevent Python from buffering stdout/stderr (better log visibility)
ENV PYTHONUNBUFFERED=1

# Non-root user for security
RUN groupadd -r aitriad && useradd -r -g aitriad -d /app -m aitriad
RUN chown -R aitriad:aitriad /app
# Ensure the ML model cache is readable
RUN chown -R aitriad:aitriad /opt/ml-env
# PowerShell needs writable cache/config dirs (default /.cache is root-owned)
RUN mkdir -p /home/aitriad/.cache /home/aitriad/.config /home/aitriad/.local/share \
    && chown -R aitriad:aitriad /home/aitriad
ENV XDG_CACHE_HOME=/home/aitriad/.cache
ENV XDG_CONFIG_HOME=/home/aitriad/.config
ENV XDG_DATA_HOME=/home/aitriad/.local/share
USER aitriad

EXPOSE 7862

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s \
  CMD curl -f http://localhost:7862/health || exit 1

CMD ["node", "dist/server/server.js"]
