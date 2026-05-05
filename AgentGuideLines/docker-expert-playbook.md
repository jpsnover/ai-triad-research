# The Docker Expert Playbook

A working reference for senior engineers and DevOps leads. Covers the full lifecycle: build, ship, run, observe, secure. Opinionated where the field has converged, balanced where it hasn't.

---

## Table of Contents

1. [Mental Model: What Containers Actually Are](#1-mental-model)
2. [Image Building Fundamentals](#2-image-building)
3. [Dockerfile Style Guide](#3-dockerfile-style-guide)
4. [Design Patterns](#4-design-patterns)
5. [Security](#5-security)
6. [Supply Chain & Compliance](#6-supply-chain)
7. [Performance](#7-performance)
8. [Networking](#8-networking)
9. [Storage & Data](#9-storage)
10. [Production Runtime](#10-production-runtime)
11. [Observability](#11-observability)
12. [Development Workflows](#12-dev-workflows)
13. [CI/CD Integration](#13-cicd)
14. [Orchestration Awareness](#14-orchestration)
15. [Troubleshooting Playbook](#15-troubleshooting)
16. [Anti-Patterns](#16-anti-patterns)
17. [The 30-Item Production Readiness Checklist](#17-checklist)

---

<a id="1-mental-model"></a>
## 1. Mental Model: What Containers Actually Are

Before any "best practice" makes sense, the mental model has to be right.

A container is **a process (or process tree) running on the host kernel inside a set of namespaces and cgroups**, with a chrooted view of a filesystem assembled from stacked image layers. That's it. Not a VM. Not a sandbox in any strong sense by default. The container shares the host's kernel; isolation is a Linux kernel feature, not a Docker feature.

Implications that flow from this:

- **A container "escape" is a kernel exploit.** Treat the kernel as part of your security boundary. Patch the host.
- **Root in the container is root on the kernel** unless you've enabled rootless mode or user namespace remapping. A `USER nonroot` directive helps but isn't a full mitigation by itself.
- **Containers are not lightweight VMs.** They're packaged processes. Design accordingly: one logical concern per container, configuration via environment, state externalized.
- **Images are content-addressed layer stacks.** A tag like `nginx:1.25` is a pointer that can move; a digest like `nginx@sha256:abc...` is immutable. This distinction matters for reproducibility and supply chain integrity.

---

<a id="2-image-building"></a>
## 2. Image Building Fundamentals

### 2.1 BuildKit is the default, use its features

Modern Docker (23.0+) uses BuildKit by default. If you're not using its features, you're leaving performance, security, and ergonomics on the table.

Always declare the syntax directive at the top of every Dockerfile so you can use modern features:

```dockerfile
# syntax=docker/dockerfile:1.7
```

This unlocks: heredocs, cache mounts, secret mounts, SSH mounts, named contexts, and improved error messages.

### 2.2 Multi-stage builds are mandatory for production

The pattern: use a heavy base with toolchains for building, then copy only the artifact into a minimal runtime base.

```dockerfile
# syntax=docker/dockerfile:1.7

# ---- Build stage ----
FROM golang:1.23-alpine AS build
WORKDIR /src

# Cache module downloads across builds
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=bind,source=go.sum,target=go.sum \
    --mount=type=bind,source=go.mod,target=go.mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/app ./cmd/app

# ---- Runtime stage ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
```

Why this matters: a Go binary in a single-stage build using `golang:1.23` runs ~1 GB. The same binary in distroless static is ~15 MB. Smaller images mean faster pulls, lower attack surface, fewer CVEs to triage.

### 2.3 Layer caching: order from least to most volatile

Each instruction creates a layer. Docker caches a layer if its inputs haven't changed. **Order Dockerfile instructions from least likely to change to most likely to change.**

```dockerfile
# Wrong order: any code change invalidates the dependency install
COPY . .
RUN npm install

# Right order: dependencies only re-install when package*.json changes
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

### 2.4 BuildKit cache mounts for package managers

Cache mounts persist between builds without ending up in the image:

```dockerfile
# Node
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Python
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Apt
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends curl
```

### 2.5 Build secrets — never via ARG or ENV

Secrets passed via `--build-arg` end up in image history. Secrets in `ENV` end up in layers. Use BuildKit secret mounts:

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t myapp .
```

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci
```

### 2.6 Always use a .dockerignore

Exclude everything irrelevant to the build. This shrinks the build context (faster), avoids cache-busting changes, and prevents accidentally baking secrets into the image.

```
.git
.gitignore
node_modules
**/__pycache__
.env
.env.*
*.log
.DS_Store
.vscode
.idea
README.md
docs/
tests/
*.test.js
Dockerfile*
docker-compose*.yml
.github/
coverage/
dist/
```

### 2.7 Pin base images

Three levels of pinning, choose based on risk tolerance:

| Level | Example | Use Case |
|---|---|---|
| Floating | `node:lts` | Never. |
| Major.minor | `node:22-alpine` | Most production workloads. |
| Digest | `node@sha256:abc...` | Regulated, high-assurance, or reproducible builds. |

**Never use `:latest` in production.** It's a tag that moves; it gives you no reproducibility and surprise upgrades.

For high-assurance deployments, pin to digest and rebuild on a schedule (Dependabot, Renovate, or similar) so updates are intentional.

---

<a id="3-dockerfile-style-guide"></a>
## 3. Dockerfile Style Guide

### 3.1 Required structure

Every Dockerfile should have, in order:

1. `# syntax=docker/dockerfile:1.7` directive
2. Stage declarations with named stages (`AS build`, `AS runtime`)
3. `WORKDIR` set explicitly (never rely on `/`)
4. Dependency installation before code copy
5. `USER` set to a non-root identity in the final stage
6. `EXPOSE` for documentation
7. `HEALTHCHECK` (if not provided by orchestrator)
8. `ENTRYPOINT` for the executable, `CMD` for default args

### 3.2 COPY vs ADD

Use `COPY`. Use `ADD` only when you genuinely need its tar-extraction or remote-URL behavior, which is rare and usually better solved another way.

### 3.3 ENTRYPOINT vs CMD — use exec form, not shell form

```dockerfile
# Wrong: spawns a shell as PID 1, breaks signal handling
CMD node server.js

# Right: app runs as PID 1 and receives signals directly
CMD ["node", "server.js"]
```

The shell form (`CMD node server.js`) wraps your command in `/bin/sh -c`, making the shell PID 1. The shell doesn't forward `SIGTERM` to children, so `docker stop` becomes `SIGKILL` after the timeout — losing in-flight work and breaking graceful shutdown.

### 3.4 One RUN per logical concern

Combine related operations into single `RUN` instructions to avoid layer bloat, but don't merge unrelated steps just to save a layer.

```dockerfile
# Good: one logical concern (install + cleanup), one layer
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
 && rm -rf /var/lib/apt/lists/*
```

### 3.5 Always set WORKDIR explicitly

Never rely on the default working directory. Use `/app` or `/srv/<service>` consistently.

### 3.6 Labels for metadata

Use OCI standard labels. They're queryable, survive across registries, and are how supply chain tooling identifies images:

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/acme/widget"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.licenses="Apache-2.0"
```

### 3.7 The canonical production Dockerfile (Node example)

```dockerfile
# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.11-alpine

# ---- Dependencies ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ---- Build ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

# ---- Runtime ----
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Create dedicated non-root user
RUN addgroup -S app && adduser -S app -G app

# tini for proper PID 1 signal forwarding
RUN apk add --no-cache tini

COPY --from=deps  --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist         ./dist
COPY              --chown=app:app package.json     ./

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

---

<a id="4-design-patterns"></a>
## 4. Design Patterns

### 4.1 Single concern per container

One container, one process tree, one logical responsibility. Web app and database are separate containers — not because Docker requires it, but because their lifecycles, scaling characteristics, and failure modes differ.

### 4.2 Sidecar

A helper container in the same network/volume context as the main container, handling cross-cutting concerns: log shipping, proxy, secret refresh, certificate rotation. The application doesn't know the sidecar exists.

### 4.3 Ambassador

A proxy container that translates between the application and external services — useful for connection pooling, retries, or service-mesh-style features without modifying the app. Examples: Envoy, HAProxy, pgbouncer.

### 4.4 Adapter

Standardizes the output of an application to a common interface — for example, a container that scrapes the app's native metrics format and exposes them as Prometheus metrics.

### 4.5 Init container

A container that runs to completion before the main container starts. Use for migrations, schema setup, dependency waits, file permissions. In Compose, model this with `depends_on` + a service that exits 0; in Kubernetes it's first-class.

### 4.6 Immutable infrastructure

Never `docker exec` into a production container to fix something. If config drifts, rebuild and redeploy. SSH-ing into containers turns your signed, scanned, attested image into a snowflake — your SBOM and provenance lose their meaning.

### 4.7 Twelve-factor alignment

Containers fit naturally into [12-factor app](https://12factor.net) principles. The most-violated ones in container land:

- **Config in environment** — not in baked-in config files
- **Logs as event streams** — write to stdout/stderr, let the platform handle aggregation
- **Disposability** — fast startup, graceful shutdown, idempotent on restart
- **Dev/prod parity** — same image runs everywhere; environment differs, image doesn't

---

<a id="5-security"></a>
## 5. Security

The most consequential security decisions happen at build time, not runtime.

### 5.1 Choose the minimal base that works

| Base | Size | Trade-off |
|---|---|---|
| `scratch` | 0 MB | Static binaries only, no shell, no libc |
| `gcr.io/distroless/*` | 2–20 MB | No shell, no package manager — hard to exec into for debug |
| `alpine` | ~5 MB | musl libc (some compatibility quirks with glibc-compiled binaries) |
| `debian:slim` / `ubuntu:slim` | ~75 MB | Full glibc, more familiar tooling |
| Chainguard Images | varies | Daily rebuilds, FIPS-compliant variants, SBOMs |

For Go/Rust/static binaries: use `scratch` or `distroless/static`. For interpreted languages: distroless language-specific images, or alpine if you accept musl.

### 5.2 Run as non-root

Every production image must end with a non-root `USER`. This is the single highest-leverage security control.

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

If you need to bind to ports below 1024, either use a higher port and let the orchestrator handle the mapping, or grant the specific capability:

```bash
docker run --cap-add=NET_BIND_SERVICE myapp
```

### 5.3 Drop all capabilities, add back only what you need

Containers get a default capability set; most apps need none of it.

```yaml
# docker-compose.yml
services:
  webapp:
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges:true
```

### 5.4 Read-only root filesystem

```yaml
services:
  webapp:
    read_only: true
    tmpfs:
      - /tmp
      - /var/run
```

If your app legitimately needs to write somewhere, mount a `tmpfs` or a named volume to that specific path. The default of "writable everywhere" is what attackers exploit to drop binaries.

### 5.5 Never expose the Docker socket

Mounting `/var/run/docker.sock` into a container is equivalent to giving that container root on the host. Any code running in it can launch new containers, mount the host filesystem, and pivot.

If you genuinely need it (CI runners, container management UIs), use a socket proxy that filters API calls (e.g., `tecnativa/docker-socket-proxy`).

### 5.6 Secrets management

Never:
- Put secrets in `ENV` instructions in the Dockerfile
- Pass them as `--build-arg` (lands in image history)
- Bake them into image layers (persist even if deleted later)

Do:
- Inject at runtime via env vars from a secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager, K8s Secrets backed by KMS)
- Use Docker secrets for Swarm
- Use BuildKit `--mount=type=secret` for build-time-only secrets
- Use short-lived, dynamic credentials where possible

### 5.7 Rootless Docker

Rootless mode runs the daemon and containers as an unprivileged user. A container escape no longer becomes root-on-host. Trade-offs:

- No support for `--network=host`
- Ports below 1024 require additional configuration
- Some networking drivers behave differently
- AppArmor not supported

For most workloads the trade-offs are acceptable. For multi-tenant or untrusted-workload hosts, rootless (or Podman) should be the default.

### 5.8 Vulnerability scanning

Scan in CI (fail builds on critical findings) and continuously (re-scan production images on a schedule because new CVEs land daily).

```bash
# Trivy
trivy image --severity CRITICAL,HIGH --exit-code 1 myapp:1.2.3

# Grype
grype myapp:1.2.3 --fail-on high

# Docker Scout
docker scout cves myapp:1.2.3
```

Be deliberate about thresholds. Failing on every CVE generates noise that gets ignored. Fail on `CRITICAL` and exploitable `HIGH` with a fix available; track the rest.

### 5.9 Runtime monitoring

Build-time scanning catches known vulnerabilities. Runtime monitoring catches unexpected behavior — a container that suddenly spawns a shell, makes an unusual network connection, or writes to an unexpected path.

Tools: Falco (CNCF, syscall-level), Tetragon (eBPF-based), commercial offerings (Sysdig, Aqua, Wiz).

Falco specifically: noisy by default. Plan for 1–2 sprints of baseline tuning before alerting in prod. Start in audit-only mode.

---

<a id="6-supply-chain"></a>
## 6. Supply Chain & Compliance

In 2026 this is no longer optional for any team shipping software at scale. The EU Cyber Resilience Act and similar regulations are pushing SBOM and provenance from "nice to have" to "required by contract."

### 6.1 SBOM (Software Bill of Materials)

A complete inventory of every component in the image. When the next zero-day drops, you can answer "are we affected" in seconds instead of days.

```bash
# Generate SBOM with BuildKit attestations
docker buildx build --sbom=true --provenance=true -t myapp:1.2.3 .

# Or with Syft
syft myapp:1.2.3 -o spdx-json > sbom.json
```

Store SBOMs alongside images in the registry. A SBOM in a folder somewhere is worthless when an incident hits at 2am.

### 6.2 Image signing

Sign every production image so deploy-time policy can verify it came from your pipeline.

```bash
# Sigstore Cosign — keyless signing via OIDC
cosign sign --yes <registry>/myapp:1.2.3

# Verify
cosign verify <registry>/myapp:1.2.3 \
  --certificate-identity-regexp="https://github.com/acme/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

### 6.3 Provenance attestations

BuildKit can emit SLSA provenance attestations describing how the image was built — source commit, build platform, parameters, timestamps.

```bash
docker buildx build \
  --provenance=mode=max \
  --sbom=true \
  -t myapp:1.2.3 \
  --push .
```

Target SLSA Level 2 minimum: hosted build platform, signed provenance. Generating provenance is half the work — you must verify it at deploy time via admission controller (Kyverno, OPA Gatekeeper, Connaisseur).

### 6.4 Trusted registries and admission policies

- Pull only from registries you control or explicitly trust.
- Use registry mirrors / pull-through caches for upstream public images. This protects against upstream tag mutation and supply chain incidents.
- Enforce admission policy that rejects unsigned images, missing SBOMs, or unverified provenance.

---

<a id="7-performance"></a>
## 7. Performance

### 7.1 Image size hierarchy

Smaller images mean faster pulls, faster autoscaling, fewer bytes to scan, less to patch. Targets:

- Under 100 MB: ideal
- 100–500 MB: acceptable for most apps
- Over 500 MB: investigate

Tools to inspect: `docker history`, `dive`.

### 7.2 Build performance

| Technique | Speedup |
|---|---|
| BuildKit cache mounts (npm/pip/apt/go) | 3–10x on warm builds |
| Order layers by volatility | Avoids unnecessary rebuilds |
| `.dockerignore` | Smaller context = faster |
| `--cache-from` registry cache in CI | Cross-runner cache reuse |
| Parallel multi-stage (free with BuildKit) | Stages without dependencies build concurrently |

CI cache pattern:

```bash
docker buildx build \
  --cache-from type=registry,ref=registry.example.com/myapp:buildcache \
  --cache-to   type=registry,ref=registry.example.com/myapp:buildcache,mode=max \
  -t myapp:${SHA} \
  --push .
```

### 7.3 Runtime performance

- **Set resource limits.** A container with no CPU/memory limit can starve every neighbor.
- **CPU shares vs limits.** Limits cap; shares prioritize. Use limits in production unless you have a good reason.
- **PID limits.** Prevent fork bombs: `--pids-limit 100`.
- **Storage driver.** `overlay2` is the default and correct choice on modern kernels.
- **JVM and Python tuning.** Containerized JVMs honor cgroup limits since JDK 10+. Set `-XX:MaxRAMPercentage=75.0` or similar; don't hard-code `-Xmx`. Python: `PYTHONUNBUFFERED=1`, set worker counts based on cgroup CPU.

### 7.4 Logging volume

Default `json-file` log driver writes to disk on the host without rotation. A chatty container can fill the disk. Always configure rotation:

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Or use a streaming driver (`fluentd`, `gelf`, `awslogs`, `journald`).

---

<a id="8-networking"></a>
## 8. Networking

### 8.1 Network drivers

- **bridge** (default): isolated network on a single host. User-defined bridges (not the default `bridge`) provide DNS-based service discovery — always create your own.
- **host**: container shares the host's network namespace. Use only when you genuinely need it (high-throughput networking, certain protocols). No port mapping; no isolation.
- **overlay**: multi-host networking for Swarm. For Kubernetes, the CNI plugin handles this.
- **macvlan**: container gets its own MAC address on the physical network. Specialized use cases.
- **none**: no networking. For batch jobs that don't need it.

### 8.2 Service discovery

User-defined bridge networks resolve container names to IPs automatically:

```yaml
services:
  app:
    networks: [backend]
  db:
    networks: [backend]
networks:
  backend:
```

The `app` container can reach `db` at `http://db:5432` — no IPs, no `/etc/hosts` hacks.

### 8.3 Port exposure

`EXPOSE` in a Dockerfile is documentation only — it doesn't open ports. The actual mapping happens at `docker run -p` or in compose's `ports:`.

Bind to specific interfaces in production:

```yaml
ports:
  - "127.0.0.1:8080:8080"   # localhost only
  - "10.0.1.5:8080:8080"    # specific interface
```

Avoid `"8080:8080"` in production — that's `0.0.0.0`, exposing on every interface.

### 8.4 Network segmentation

Multi-network designs let you enforce least-privilege at the network layer:

```yaml
services:
  web:
    networks: [frontend, backend]
  db:
    networks: [backend]      # not on frontend, unreachable from web's public side
networks:
  frontend:
  backend:
    internal: true            # no external connectivity
```

---

<a id="9-storage"></a>
## 9. Storage & Data

### 9.1 Volumes vs bind mounts

| Type | Use case |
|---|---|
| Named volume | Persistent data managed by Docker. Default for databases. |
| Bind mount | Host path mounted into container. Use for dev (source code), not for production data. |
| tmpfs | In-memory only. Good for sensitive scratch data, read-only filesystem escape hatches. |

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - dbdata:/var/lib/postgresql/data    # named volume
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro   # bind mount, read-only
volumes:
  dbdata:
```

### 9.2 Containers are ephemeral

Anything not in a volume is lost when the container is replaced. Design accordingly:

- Application state → external service (database, object store)
- Logs → stdout, picked up by log driver
- Cache → either acceptable to lose, or external (Redis)
- Uploads → object store (S3 / GCS), never local disk

### 9.3 Backup strategy for volumes

Volumes are not magically backed up. For databases, use the database's own backup mechanism, not a volume snapshot — file-level snapshots of running databases produce inconsistent backups.

For application data volumes, periodic snapshots via the orchestrator or cloud provider are usually sufficient. Test the restore. A backup you haven't restored is a hope, not a backup.

### 9.4 Permissions on bind mounts

Common dev-environment frustration: container runs as UID 1001, files written into a bind-mounted directory are owned by 1001 on the host. Solutions:

- Match the host UID with `--user $(id -u):$(id -g)` (Linux only, breaks on macOS/Windows)
- Use Docker Desktop's file sharing, which handles this transparently
- Use named volumes for data instead of bind mounts where possible

---

<a id="10-production-runtime"></a>
## 10. Production Runtime

### 10.1 Restart policies

| Policy | When |
|---|---|
| `no` | Default. Don't use in production. |
| `on-failure` | Restart on non-zero exit. Good for batch jobs. |
| `unless-stopped` | Restart unless explicitly stopped. Good for services. |
| `always` | Restart even if stopped. Use carefully — interferes with intentional stops. |

Under an orchestrator (K8s, ECS, Nomad), the orchestrator owns restart policy — set it to `no` in the container config.

### 10.2 Resource limits — non-negotiable

Every production container needs limits. Not requests, *limits*. Without them, one runaway process takes down the host.

```yaml
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 1G
    reservations:
      cpus: "0.5"
      memory: 256M
```

(Note: `deploy:` is honored by Swarm and `docker compose up` in newer versions; for plain Compose, use top-level `mem_limit`/`cpus` for compatibility.)

### 10.3 Signal handling and graceful shutdown

When Docker stops a container:

1. Sends `SIGTERM` to PID 1
2. Waits `stop_grace_period` (default 10s)
3. Sends `SIGKILL` (uncatchable)

Three things must be right:

**1. PID 1 must receive the signal.** Use exec form CMD/ENTRYPOINT, not shell form.

**2. PID 1 must handle signals.** Many language runtimes don't do signal handling well as PID 1. Use `tini` or `dumb-init`, or pass `--init` to `docker run`:

```dockerfile
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
```

**3. Your application must implement graceful shutdown:**

```javascript
let shuttingDown = false;
const server = app.listen(3000);

const shutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down gracefully`);
  shuttingDown = true;

  server.close(async () => {
    await db.end();
    process.exit(0);
  });

  // Hard exit if cleanup hangs
  setTimeout(() => process.exit(1), 25_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

Set `stop_grace_period` to be longer than your worst-case in-flight request:

```yaml
services:
  app:
    stop_grace_period: 30s
```

### 10.4 Health checks

Two distinct concepts:

- **Liveness**: is the process working? Failing this restarts the container.
- **Readiness**: is the process ready to serve traffic? Failing this removes from the load balancer but doesn't restart.

Docker's `HEALTHCHECK` is a single combined check. Kubernetes splits them. Both, ideally, should hit a dedicated `/healthz` and `/readyz` endpoint that does meaningful checks (database reachable, dependencies up) — not just "did the HTTP server respond."

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:8080/healthz || exit 1
```

`--start-period` matters: gives the app time to come up before health failures count. Set it generously.

---

<a id="11-observability"></a>
## 11. Observability

### 11.1 Logs

Write structured JSON to stdout. Let the platform handle aggregation. Don't write to files inside the container.

Use a log driver appropriate for the destination:
- `json-file` with rotation for local dev / single host
- `journald` for systemd hosts
- `fluentd`, `gelf`, `awslogs`, `gcplogs` for managed sinks

Add structured context (request ID, user ID, trace ID) so logs are joinable across services.

### 11.2 Metrics

Expose Prometheus-format metrics on a separate port (typically 9090 or 9100). Make sure your network policy doesn't expose the metrics port externally.

### 11.3 Tracing

OpenTelemetry is the convergence point. Instrument once, export to Jaeger / Tempo / Datadog / Honeycomb / etc. The SDK is set up via env vars, fitting cleanly into the 12-factor model:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_SERVICE_NAME=widget-api
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod
```

### 11.4 Debugging running containers

```bash
# Inspect state
docker inspect <container>
docker stats <container>
docker top <container>

# Logs
docker logs -f --tail=100 <container>

# Exec — only in dev/staging, never as a fix in prod
docker exec -it <container> sh

# When the image has no shell (distroless): debug via ephemeral container
# (Kubernetes: kubectl debug. Docker: copy the binary out and run separately.)

# What's actually running
docker exec <container> ps auxf

# Network namespace inspection
docker exec <container> netstat -tulpn   # if available
```

---

<a id="12-dev-workflows"></a>
## 12. Development Workflows

### 12.1 Compose for local development

`docker-compose.yml` should describe the *entire* dev environment: app, db, message broker, dependent services. New devs should `git clone && docker compose up` and have a working environment.

```yaml
services:
  app:
    build:
      context: .
      target: dev          # multi-stage Dockerfile with a dev target
    volumes:
      - .:/app
      - /app/node_modules  # anonymous volume preserves container's node_modules
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    volumes:
      - dbdata:/var/lib/postgresql/data
volumes:
  dbdata:
```

### 12.2 Compose overrides

`docker-compose.yml` for shared definition, `docker-compose.override.yml` for local-only changes (auto-loaded), `docker-compose.prod.yml` for prod-shaped overrides used in CI/staging.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up
```

### 12.3 Same Dockerfile, different targets

Use multi-stage builds with named targets to produce dev and prod images from one Dockerfile:

```bash
docker build --target dev   -t myapp:dev   .   # has source mounts, debugger
docker build --target prod  -t myapp:prod  .   # minimal, no devDependencies
```

This keeps dev and prod parity tight — same base layers, same dependency installs, only the final stage differs.

### 12.4 Hot reload

Mount source as a volume; let the framework's watcher rebuild. Make sure file watching works: macOS/Windows file events through Docker Desktop sometimes need polling fallback. Tools that handle this well: nodemon, vite, air (Go), watchexec.

### 12.5 Dev containers (VS Code, JetBrains)

`.devcontainer/devcontainer.json` defines a dev environment as code. New contributor opens the repo, IDE prompts to "Reopen in container," they're working in 2 minutes with the right toolchain, the right linters, the right extensions.

---

<a id="13-cicd"></a>
## 13. CI/CD Integration

### 13.1 Image tagging strategy

Use multiple tags per build:

```
myapp:1.2.3              # semantic version (immutable)
myapp:1.2                # major.minor (rolls forward)
myapp:1                  # major (rolls forward)
myapp:sha-abc1234        # git sha (immutable, traceable)
myapp:main               # branch (mutable, latest from main)
myapp:1.2.3-rc.1         # pre-release
```

Production deployments should reference the immutable digest or sha-tagged version. Mutable tags are for development convenience.

### 13.2 Multi-architecture builds

```bash
docker buildx create --use --name multiarch
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t myorg/myapp:1.2.3 \
  --push .
```

ARM64 matters: AWS Graviton, GCP Tau, Apple Silicon dev machines. Single-arch images break workflows.

### 13.3 Pipeline stages

A production-grade pipeline has, in order:

1. **Lint** — Dockerfile linting (`hadolint`), YAML linting
2. **Build** — multi-stage, with cache from registry
3. **Unit test** — in a test stage of the Dockerfile or separate runner
4. **Vulnerability scan** — fail on CRITICAL with available fix
5. **SBOM generation** — attached as build attestation
6. **Sign** — Cosign keyless via OIDC
7. **Push** — to registry with all tags
8. **Integration test** — pull the actual image, run against test dependencies
9. **Deploy** — staging first, then prod via gated approval

### 13.4 GitHub Actions example

```yaml
name: Build and deploy
on:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read
  packages: write
  id-token: write    # for cosign keyless

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha,prefix=sha-

      - id: build
        uses: docker/build-push-action@v6
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: mode=max
          sbom: true
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}@${{ steps.build.outputs.digest }}
          severity: CRITICAL,HIGH
          exit-code: '1'
          ignore-unfixed: true

      - uses: sigstore/cosign-installer@v3
      - run: cosign sign --yes ghcr.io/${{ github.repository }}@${{ steps.build.outputs.digest }}
```

---

<a id="14-orchestration"></a>
## 14. Orchestration Awareness

Docker is a tool for *building* and *running individual containers*. Orchestration is a separate concern.

### 14.1 The progression

| Tool | When |
|---|---|
| Docker run / Compose | Local dev, single-host services, simple apps |
| Docker Swarm | Built into Docker, simple multi-host clustering. Maintenance mode in practice — workable for small teams who don't want K8s complexity. |
| Kubernetes | Industry standard for production clusters. Steep learning curve, vast ecosystem. |
| ECS / Cloud Run / Fly / Nomad | Managed alternatives, varying degrees of K8s-likeness |

### 14.2 What changes when you move to Kubernetes

Patterns that worked with `docker run` need rethinking:

- **Networking**: pods, services, ingress instead of `-p` mappings
- **Storage**: PersistentVolumes, StorageClasses instead of `-v`
- **Health checks**: liveness, readiness, *startup* probes (separate concepts) instead of HEALTHCHECK
- **Restart policy**: handled by the controller, not the container
- **Config and secrets**: ConfigMaps and Secrets instead of `.env` files
- **Service discovery**: cluster DNS, not bridge network DNS

What stays the same: the image format, the container runtime contract, signal handling, graceful shutdown, resource limits, observability patterns.

### 14.3 K8s-friendly container design

A container designed well for Kubernetes is also a well-designed container in general:

- Listens on a configurable port (env var)
- Reads config from environment
- Logs to stdout in JSON
- Implements `/healthz` and `/readyz`
- Handles SIGTERM with graceful shutdown
- Tolerates being killed and restarted at any time
- Doesn't assume local disk persists

---

<a id="15-troubleshooting"></a>
## 15. Troubleshooting Playbook

### 15.1 Image build fails

| Symptom | Likely cause |
|---|---|
| `COPY failed: file not found` | `.dockerignore` excludes it, or path is wrong |
| Build hangs on dependency install | Network egress blocked, or upstream registry slow |
| Massive build context upload | Missing or insufficient `.dockerignore` |
| Cache never hits | Layer ordering wrong, or instruction inputs change every build |

### 15.2 Container won't start

```bash
docker logs <container>
docker inspect <container>          # look at State.ExitCode, State.Error
docker events --since 10m           # what happened recently
```

Common causes: missing env var, can't bind port (in use or permission denied), can't reach dependency, bad CMD, file permission denied (running as non-root, files owned by root).

### 15.3 Container starts then exits immediately

The PID 1 process completed (or failed). For services, this is wrong — they should run forever.

- Shell-form CMD that doesn't `exec` something long-running
- App crashes on missing config; check logs
- Healthcheck not the issue — it doesn't kill containers, only orchestrators do
- App is single-shot (a script, not a server); is this actually a service?

### 15.4 OOMKilled

`docker inspect <container> | grep -i oom` shows `OOMKilled: true`.

- Memory limit too low for actual working set
- Memory leak in the app
- For JVM: heap too large for the limit (set `-XX:MaxRAMPercentage=75`)
- For Node: heap too large (`--max-old-space-size`)

### 15.5 Container is slow

```bash
docker stats <container>            # CPU, memory, network, IO
docker top <container>              # process tree
```

- CPU throttled? CPU limits too tight
- Memory swapping? Memory limit too tight
- Disk slow? Bind mount on a slow filesystem (especially Docker Desktop on Mac)
- Network slow? Wrong network driver, or DNS resolution issue

### 15.6 Network connectivity issues

```bash
# Can the container reach the destination?
docker exec <container> nslookup <hostname>
docker exec <container> nc -zv <host> <port>

# What's the container's network?
docker inspect <container> --format '{{json .NetworkSettings.Networks}}'

# What's exposed where?
docker port <container>
```

Common: not on the same user-defined network (services can't resolve each other by name), wrong port binding, firewall on the host.

### 15.7 docker exec fails on production image

Distroless images have no shell. This is a feature, not a bug.

- For debugging, use `kubectl debug` (K8s) or sidecar a debug container with the same network/PID namespace
- For occasional ops, build a `debug` target in the Dockerfile that bundles tools, run it separately
- Resist the urge to add a shell "just for debugging" — it weakens the security posture for everyone

---

<a id="16-anti-patterns"></a>
## 16. Anti-Patterns

A non-exhaustive catalog of things to never do, and why.

| Anti-pattern | Why it's bad |
|---|---|
| `FROM ubuntu:latest` (or any `:latest`) | No reproducibility, surprise upgrades break prod |
| Running as root | A container escape becomes root on the host |
| Mounting `/var/run/docker.sock` | Equivalent to giving the container root on the host |
| Secrets in `ENV` instructions | Persist in image layers forever |
| Secrets in `--build-arg` | Persist in image history forever |
| `apt-get update` without install in same RUN | Cached `update` becomes stale, installs old packages |
| Multiple processes (supervisord, init scripts) | Breaks restart semantics, hides crashes, complicates logging |
| `chmod 777` to "fix" permissions | Hides the real problem, leaves security hole |
| `docker exec` to fix prod issues | Image and reality drift; SBOM and signing become lies |
| Bind-mounting source in production | Image isn't self-contained, deploys are non-reproducible |
| Single-stage builds with toolchains | 10x larger images, 10x larger attack surface |
| No resource limits | One container can take down the host |
| No health checks | Orchestrators can't tell when the app is broken |
| Logging to files inside the container | Logs lost on restart, fills container disk |
| `--privileged` | Disables nearly all container security |
| `--network=host` for services | No network isolation, port conflicts |
| Storing data in container layer | Lost on restart |
| Hardcoded host IPs / ports | Breaks the moment the topology changes |
| Same tag mutated repeatedly | Can't roll back, can't reproduce, can't audit |
| Skipping `.dockerignore` | Slow builds, bloated images, accidentally baked-in `.env` |

---

<a id="17-checklist"></a>
## 17. The 30-Item Production Readiness Checklist

A container is ready for production when:

**Image**
1. ☐ Multi-stage build with named stages
2. ☐ Minimal base image (distroless / alpine / slim)
3. ☐ Pinned base image (major.minor minimum, digest preferred)
4. ☐ `.dockerignore` configured
5. ☐ No secrets in any layer or ARG
6. ☐ OCI labels set (source, revision, version)
7. ☐ Image size under 500 MB (ideally under 100)

**Security**
8. ☐ Runs as non-root user (`USER` set)
9. ☐ All capabilities dropped, only required ones added back
10. ☐ `no-new-privileges:true` set
11. ☐ Read-only root filesystem with explicit tmpfs/volumes for writes
12. ☐ Vulnerability scan passes (no unfixed CRITICAL)
13. ☐ Signed image (Cosign)
14. ☐ SBOM generated and stored alongside image
15. ☐ Provenance attestation generated

**Runtime**
16. ☐ Resource limits set (CPU, memory, PIDs)
17. ☐ Init process or `tini`/`dumb-init` for signal forwarding
18. ☐ Application handles SIGTERM with graceful shutdown
19. ☐ `stop_grace_period` exceeds worst-case in-flight request
20. ☐ Restart policy appropriate for workload
21. ☐ Health check (liveness + readiness in K8s)

**Observability**
22. ☐ Logs go to stdout/stderr in structured format
23. ☐ Log rotation configured (or remote log driver)
24. ☐ Metrics exposed in Prometheus format
25. ☐ Tracing instrumented (OpenTelemetry)

**Operational**
26. ☐ Configuration via environment variables
27. ☐ Secrets injected at runtime from a secrets manager
28. ☐ State externalized (DB, object store) — container is stateless
29. ☐ Tested on the same architecture(s) as production
30. ☐ Documented: ports, env vars, volumes, dependencies, runbooks

When all 30 are checked, you're not just running a container — you're operating one.

---

## Further Reading

- [Docker Official Docs — Building best practices](https://docs.docker.com/build/building/best-practices/)
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [SLSA — Supply chain Levels for Software Artifacts](https://slsa.dev)
- [Sigstore / Cosign](https://www.sigstore.dev)
- [The Twelve-Factor App](https://12factor.net)
- [Distroless images](https://github.com/GoogleContainerTools/distroless)
- [Chainguard Images](https://images.chainguard.dev)

---

*Last reviewed: May 2026. Container security and supply chain practices evolve; revisit at least quarterly.*
