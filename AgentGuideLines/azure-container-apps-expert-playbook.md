# The Azure Container Apps Expert Playbook

A working reference for engineers and platform leads operating Azure Container Apps (ACA) in production. Assumes container fundamentals and prior cloud experience.

This is a companion to the Docker playbook — that one covers what's *in* the image and what runs *inside* the container. This one covers what Azure does *around* it: the environment, networking, identity, scaling, observability, cost, and governance.

---

## Table of Contents

1. [Mental Model: What ACA Actually Is](#1-mental-model)
2. [When to Pick ACA — and When Not To](#2-when-to-pick-aca)
3. [Environments and Workload Profiles](#3-environments-workload-profiles)
4. [The Container App: Configuration, Revisions, Replicas](#4-container-app)
5. [Scaling with KEDA](#5-scaling)
6. [Networking](#6-networking)
7. [Identity and Access](#7-identity)
8. [Secrets Management](#8-secrets)
9. [Container Registry Integration](#9-registry)
10. [Jobs](#10-jobs)
11. [Dapr (When It Helps, When It's Overkill)](#11-dapr)
12. [Observability](#12-observability)
13. [Cost Optimization](#13-cost)
14. [Reliability and Resiliency](#14-reliability)
15. [Security and Governance](#15-security)
16. [Infrastructure as Code](#16-iac)
17. [CI/CD](#17-cicd)
18. [Troubleshooting Playbook](#18-troubleshooting)
19. [Anti-Patterns](#19-anti-patterns)
20. [Production Readiness Checklist](#20-checklist)

---

<a id="1-mental-model"></a>
## 1. Mental Model: What ACA Actually Is

Azure Container Apps is **a managed Kubernetes platform with the Kubernetes hidden**. Underneath the abstraction is AKS, KEDA, Dapr, and Envoy. You don't get kubectl, you don't see nodes, you don't manage the control plane — but the primitives leak through, and understanding them helps everything else make sense.

What you actually get:

- **Environments** ≈ a Kubernetes cluster boundary. All apps in one environment share networking and a Log Analytics workspace.
- **Container Apps** ≈ a Deployment + Service + Ingress in one resource. Each app produces one or more *revisions*.
- **Revisions** ≈ immutable ReplicaSets. A new revision is created when you change anything in the `template` section. Revisions can run side by side; you control traffic split.
- **Replicas** ≈ pods. Created and destroyed by KEDA based on scale rules.
- **Containers within a replica** ≈ the containers in a pod (main + sidecars + init).
- **Envoy** terminates TLS, handles ingress, routes between revisions, and proxies internal service-to-service traffic.

Implications:

- **You write the application; Azure runs the orchestration.** Everything K8s-shaped is true here, but you can't override most of it.
- **Configuration drives revisions, not deployments.** "Deploying" usually means "creating a new revision with a new image tag." Old revisions don't disappear by default.
- **Scale to zero is a real thing here**, unlike most managed PaaS. It changes the economics and the cold-start equations you'll plan around.
- **You're constrained by the abstraction.** No `--privileged`. No host networking. No DaemonSets. No kubectl. If you need that, you need AKS.

---

<a id="2-when-to-pick-aca"></a>
## 2. When to Pick ACA — and When Not To

Azure has too many compute services. Here's how ACA fits among the real alternatives.

| Service | When it's the right pick |
|---|---|
| **Container Apps** | Containerized microservices, event-driven workers, scheduled jobs, APIs that benefit from scale-to-zero. You want K8s capabilities without K8s operations. |
| **AKS** | You need kubectl, custom operators, DaemonSets, GPU sharing patterns, multi-cluster federation, or service mesh control beyond what Dapr offers. You have or need K8s expertise on staff. |
| **App Service** | Web apps that don't need containers, or that you want zero-config deployment for. Mature ecosystem, deploy-from-Git slots, integrated authentication. |
| **Functions** | Event-driven code where the function model fits naturally. Ephemeral execution. Now also runs on ACA via Functions-on-ACA. |
| **Container Instances (ACI)** | Single-shot tasks, burst workloads, hyper-V isolation requirements. Fast start, no orchestration. |
| **Azure Spring Apps** | Spring Boot specifically, with Spring-native configuration and service discovery. |

**Concrete signs ACA is wrong:**
- You need to run privileged containers, host-network containers, or DaemonSets.
- You need full control over the K8s API (custom CRDs, admission webhooks).
- Your workload is a long-running stateful set with strict ordering guarantees.
- You're already deep in AKS and the team has the skills; switching costs aren't justified.

**Concrete signs ACA is right:**
- Microservices with HTTP / gRPC / queue triggers.
- Bursty traffic where scale-to-zero is valuable.
- Background workers consuming Service Bus / Event Hubs / Storage Queues.
- Teams that want to ship containers without learning Kubernetes operations.

---

<a id="3-environments-workload-profiles"></a>
## 3. Environments and Workload Profiles

The environment is the unit of isolation. Plan it carefully — several decisions are immutable.

### 3.1 Environment types

There are two environment types, but in 2026 you should default to **workload profiles environments** unless you have a specific reason not to. The older "Consumption-only" environment is still around but can't use private endpoints, has fewer networking features, and limits you on workload variety.

### 3.2 Workload profiles: Consumption vs Dedicated

A workload profiles environment supports multiple profiles that apps can be assigned to:

- **Consumption profile**: pay-per-use, scale to zero, fixed sizes (up to 4 vCPU / 8 GB per replica). Default and cheapest for variable workloads.
- **Dedicated profiles** (D-series, E-series, GPU): you pay for provisioned capacity per node. Multiple apps share a node. Larger sizes available, plus GPU SKUs.

You can mix: consumption for bursty front-ends and event workers, dedicated for steady-state services where the math works out.

The breakeven is roughly: if a workload sustains the equivalent of one always-on replica's worth of CPU/memory, dedicated typically wins on cost. Below that, consumption wins.

### 3.3 Decisions that are immutable

These decisions can't be changed after environment creation. Get them right or rebuild:

- **Internal vs external load balancer.** Internal = private VIP, no public ingress. External = public VIP available.
- **VNet vs auto-generated network.** Cannot be changed.
- **Subnet.** Cannot be changed; size carefully.
- **Region.** Obviously.
- **Zone redundancy.** Cannot be enabled later.

### 3.4 Subnet sizing

Workload profiles environments require a `/27` minimum, but `/23` or larger is recommended for production. The platform reserves IPs for management, scaling headroom, and during upgrades. Running out of subnet space mid-scale is painful and irreversible without rebuild.

The subnet must be delegated to `Microsoft.App/environments`.

### 3.5 One environment, many apps — or many environments?

**One environment per environment-tier per region** is the typical pattern: dev, staging, prod, each as its own ACA environment. Separate Log Analytics workspaces (or at least separate environments writing to one workspace).

Reasons to split further:
- Strict network isolation between business units → separate VNets, separate environments.
- Compliance boundaries (PCI vs non-PCI workloads).
- Vastly different scale profiles where shared subnet pressure becomes a problem.

Reasons not to split:
- "It feels cleaner" — you'll pay double for IPs, load balancers, and management overhead.
- One noisy app — that's what resource limits are for.

### 3.6 Zone redundancy

Enable it. It's a one-time decision at environment creation, costs nothing extra at the environment level, and protects against single-zone failures. Set `minReplicas >= 2` (ideally 3) on production apps so replicas actually spread across zones.

---

<a id="4-container-app"></a>
## 4. The Container App: Configuration, Revisions, Replicas

### 4.1 The configuration model

Every container app has two sections in its definition:

- **`configuration`**: stable settings — ingress, registries, secrets, Dapr, max inactive revisions. Changes here do **not** create a new revision.
- **`template`**: workload definition — containers, scale rules, init containers, volumes. Changes here **do** create a new revision.

This split matters. Updating a secret reference doesn't roll your app; updating an environment variable does.

### 4.2 Revision modes

- **Single revision** (default): each new revision gets 100% of traffic; the previous revision is deactivated. Simpler.
- **Multiple revisions**: revisions persist and you split traffic between them. Required for blue/green and canary patterns.

For production, set multiple-revision mode and explicitly manage traffic. It's worth the small extra complexity.

### 4.3 Traffic splitting

Once in multiple-revision mode, traffic is allocated by weight in `configuration.ingress.traffic[]`:

```bicep
ingress: {
  external: true
  targetPort: 8080
  traffic: [
    { revisionName: 'myapp--v2', weight: 10, label: 'canary' }
    { revisionName: 'myapp--v1', weight: 90 }
  ]
}
```

Patterns this enables:
- **Canary**: 10% / 90% → 50% / 50% → 100% / 0%
- **Blue/green**: deploy new revision at 0%, smoke-test via the labeled URL, then flip to 100%
- **A/B test**: split traffic between revisions with different feature flags

Each labeled revision gets its own URL: `https://myapp---canary.<env>.<region>.azurecontainerapps.io`. Use this for targeted smoke tests before shifting traffic.

### 4.4 Revision suffix

By default, revision names are auto-generated (`myapp--abc1234`). Set `template.revisionSuffix` to something meaningful (e.g., the git short SHA or build number) so you can tell at a glance what's deployed.

### 4.5 Replica resource limits

Each replica has a CPU and memory allocation. **CPU and memory are coupled** in ACA — you can't independently set them. Common pairings: 0.25 vCPU / 0.5 GB, 0.5 / 1 GB, 1 / 2 GB, 2 / 4 GB, 4 / 8 GB on consumption.

Right-size based on actual measured usage from production, not from local dev. Over-provisioning wastes money on consumption (you're billed by allocated vCPU-seconds and memory-GB-seconds); under-provisioning causes throttling and OOM kills.

### 4.6 Probes (liveness, readiness, startup)

ACA exposes the standard Kubernetes probe model. Always configure:

```bicep
probes: [
  {
    type: 'Liveness'
    httpGet: { path: '/healthz', port: 8080 }
    periodSeconds: 30
    timeoutSeconds: 5
    failureThreshold: 3
  }
  {
    type: 'Readiness'
    httpGet: { path: '/readyz', port: 8080 }
    periodSeconds: 10
    initialDelaySeconds: 5
    timeoutSeconds: 5
  }
  {
    type: 'Startup'
    httpGet: { path: '/healthz', port: 8080 }
    periodSeconds: 10
    failureThreshold: 30   // 5 minutes to start
  }
]
```

`Startup` is the one most teams forget. Without it, a slow-starting app can be killed by liveness before it ever serves a request. Set `failureThreshold` generously and keep liveness probes from running until startup succeeds.

---

<a id="5-scaling"></a>
## 5. Scaling with KEDA

Scaling is ACA's killer feature. Get it right and your costs and responsiveness both improve.

### 5.1 The model

Each app has:
- `minReplicas` — floor (0 to N)
- `maxReplicas` — ceiling (1 to 1000, default 10)
- One or more **scale rules** that drive the replica count between those bounds

Scale rules are KEDA scalers, expressed in ACA's dialect. KEDA polls the trigger source on a defined interval and computes the desired replica count.

### 5.2 The scaler catalog

The most common scalers in production:

| Scaler | Use case |
|---|---|
| `http` | Concurrent HTTP requests per replica |
| `cpu` / `memory` | Steady-state services (cannot scale to zero) |
| `azure-servicebus` | Service Bus queue/topic depth |
| `azure-eventhub` | Event Hubs unprocessed events |
| `azure-queue` | Storage queue depth |
| `azure-blob` | Blob count |
| `kafka` | Kafka consumer lag |
| `redis` | Redis stream/list length |
| `cron` | Time-window scaling (warm up before known peak) |

There are 50+ KEDA scalers. ACA supports all `ScaledObject`-style scalers for apps and `ScaledJob`-style for event-driven jobs.

### 5.3 HTTP scaling

```bicep
scale: {
  minReplicas: 1
  maxReplicas: 30
  rules: [
    {
      name: 'http-rule'
      http: {
        metadata: {
          concurrentRequests: '50'   // target per replica
        }
      }
    }
  ]
}
```

The `concurrentRequests` value is a *target*, not a hard cap. If you set 50 and traffic spikes to 500 concurrent, KEDA will scale toward 10 replicas.

### 5.4 Queue-based scaling (the canonical pattern)

For background workers, CPU scaling is a trap — workers idle on queue receive look fine to a CPU rule even when the queue is exploding. Always scale on queue depth.

```bicep
scale: {
  minReplicas: 0
  maxReplicas: 20
  rules: [
    {
      name: 'sb-queue-rule'
      custom: {
        type: 'azure-servicebus'
        metadata: {
          queueName: 'orders'
          messageCount: '10'        // 1 replica per 10 backlog
          namespace: 'mybus'
        }
        identity: '<user-assigned-identity-resource-id>'
      }
    }
  ]
}
```

`messageCount` is the divisor: backlog ÷ messageCount = desired replicas (capped by `maxReplicas`).

### 5.5 Scale-to-zero economics and traps

Scale to zero is the "serverless" pricing story. Tradeoffs:

- **Cold start**: first request after scale-to-zero pays for image pull + container start + app boot. Range: a few seconds for a small Go binary, 30+ seconds for a large .NET / Java app.
- **Polling interval**: KEDA polls scalers every 30s by default. For sporadic traffic with rapid processing, the queue can be empty when KEDA polls — leading to scale-to-zero even when messages keep arriving. Lower `pollingInterval` for low-but-steady workloads.
- **HTTP scale-to-zero** holds connections briefly during scale-up; first request waits for a replica.

**When to set `minReplicas = 0`:**
- Truly bursty workloads with significant idle time.
- Workers that can tolerate cold start latency.
- Dev/staging environments where saving cost matters more than sub-second response.

**When to set `minReplicas >= 1`:**
- Latency-sensitive request paths.
- Anything fronted by a customer SLA.
- Workers consuming low-but-continuous streams where polling races cost throughput.

**When to set `minReplicas >= 2` or 3:**
- Any production app you care about. With zone redundancy enabled, this is what spreads across AZs.

### 5.6 Scaling rule authentication: managed identity

KEDA scalers in ACA now support managed identity authentication via the `identity` property on the scale rule (in addition to secret-based auth). Use it. Connection strings in scaler config are an unnecessary secret-management burden.

```bicep
custom: {
  type: 'azure-servicebus'
  metadata: { ... }
  identity: '<user-assigned-identity-resource-id>'  // or 'system'
}
```

Grant that identity `Azure Service Bus Data Receiver` on the namespace (don't reach for Owner — least privilege).

### 5.7 Cool-down and polling

- `pollingInterval` — how often KEDA checks the trigger. Default 30s. Lower it for low-frequency-but-steady patterns.
- `cooldownPeriod` — only applies when scaling from 1 → 0. Default 300s. Increase if cold start cost is high.
- Scaling between 1 and N is governed by KEDA's HPA-style algorithm and isn't affected by cooldown.

### 5.8 Concurrency model inside the replica

Scaling decides how many replicas. *Inside* a replica, your application controls concurrency. Make sure your app is configured for the workload:
- HTTP servers: tune worker/thread/connection counts for the CPU/memory budget.
- Queue workers: receive in batches, process concurrently up to a sensible cap, prefetch carefully (Service Bus prefetch above 1× the expected processing rate causes lock-expiry messes).

A replica that can't use its CPU because it's single-threaded scales horizontally when it should scale internally. Fix the app first.

---

<a id="6-networking"></a>
## 6. Networking

Network architecture is where teams most often paint themselves into corners. The decisions are mostly immutable.

### 6.1 The four networking shapes

| Shape | When |
|---|---|
| **External, no VNet** | Public-facing apps with no private dependencies. Quickest path. |
| **External, custom VNet** | Public-facing apps that need to reach private resources (private endpoints to Storage / SQL / Key Vault). |
| **Internal, custom VNet** | Internal-only apps. Public access blocked. Requires private DNS for resolution. |
| **Internal + private endpoint** | Strict zero-trust scenarios. Even the load balancer is private. |

You cannot flip between External and Internal after creation.

### 6.2 Ingress visibility (per-app)

Independent of the environment, each app's ingress can be:
- **Disabled** — no ingress, app only runs as a worker.
- **Limited to Container Apps Environment** — only other apps in the same environment can call it. Best default for internal microservices.
- **Limited to VNet** — internal load balancer; reachable from the VNet (and peered VNets via private DNS).
- **External** — the environment's public LB exposes it (only on external environments).

The pattern: front-end apps `External` (or `Limited to VNet` behind App Gateway), back-end apps `Limited to Container Apps Environment`. The internal-only setting plus DNS-based service discovery means backend apps don't need authentication-at-the-edge complexity — they're not reachable from outside.

### 6.3 Service discovery

Within an environment, apps reach each other via simple DNS:

```
http://orders.internal.<env-id>.<region>.azurecontainerapps.io   // FQDN
http://orders                                                     // short name (same environment)
```

The short name works inside the same environment. Use it. No need for explicit service registry.

### 6.4 Custom domains and TLS

ACA terminates TLS at Envoy. Two paths to bring a custom domain:

- **Managed certificates** (free, auto-renewed). Best default. Requires the domain to validate via DNS.
- **Bring-your-own certificate** (uploaded PFX, or a Key Vault reference). Required for wildcards and EV certs.

For multi-domain setups behind Front Door or App Gateway, terminate TLS at the front layer and use ACA's certificate for backend hop encryption (or peer-to-peer encryption inside the environment).

### 6.5 Peer-to-peer encryption

ACA can encrypt traffic between replicas inside the environment with mTLS via Envoy, transparent to the application. Enable it for compliance scenarios. There's a small CPU cost, but it removes the need to do TLS in your application code for service-to-service calls.

### 6.6 Egress control

For any production deployment that handles sensitive data, control outbound traffic:
- **NAT Gateway** for predictable egress IPs (whitelisting downstream).
- **User-defined routes** sending traffic through Azure Firewall or an NVA.
- **Private endpoints** for Azure PaaS dependencies (Storage, Key Vault, SQL, ACR) so traffic stays on the Microsoft backbone.

### 6.7 Application Gateway / Front Door in front

Common production fronting pattern:

```
Internet → Azure Front Door (WAF, global anycast)
        → Application Gateway (WAF, regional, mTLS to backend)
        → ACA (Internal, Limited to VNet)
```

Why bother:
- WAF protection at the edge (Front Door)
- Static IP / IP allowlist enforcement
- L7 rules and rewrites that ACA's Envoy doesn't expose
- Multi-region failover

For simpler deployments, Front Door alone is enough. App Gateway adds value when you need WAF + private backend in a single region.

---

<a id="7-identity"></a>
## 7. Identity and Access

Stop using connection strings. Use managed identity for everything.

### 7.1 System-assigned vs user-assigned

| | System-assigned | User-assigned |
|---|---|---|
| Lifecycle | Tied to the app; deleted when app deleted | Independent; survives app deletion |
| Reuse | One per app | Many apps can share |
| RBAC bookkeeping | Re-grant if app recreated | Grant once, reuse |
| Recommended for | Simple apps, isolation | Production, IaC pipelines, shared identities |

**Default to user-assigned** for production. Your IaC creates the identity, grants it the necessary RBAC, then attaches it to the app. If you tear down and rebuild the app, the identity and its grants persist.

### 7.2 Init / main / all scoping

Newer ACA API versions (2024-02-02-preview and later) let you scope managed identity availability:

- `Init` — only init containers can use it
- `Main` — only main containers
- `All` — both (default)
- `None` — not available to your code at all (still usable for ACR pull, scaler auth, Key Vault refs)

Use `None` for identities used only for ACR image pull or Key Vault secret resolution — your application doesn't need IMDS access for credentials it never uses, and this enforces least privilege at the platform level.

### 7.3 Common RBAC grants

| Resource | Role |
|---|---|
| Azure Container Registry | `AcrPull` (image pull) |
| Service Bus namespace | `Azure Service Bus Data Receiver` / `Sender` / `Owner` |
| Event Hubs | `Azure Event Hubs Data Receiver` / `Sender` |
| Storage Account | `Storage Blob Data Reader` / `Contributor`, `Storage Queue Data Contributor` |
| Key Vault | Use **Azure RBAC** mode, not access policies. `Key Vault Secrets User` for read |
| SQL / PostgreSQL / Cosmos | Each has data-plane RBAC roles; prefer those over connection strings |

Always grant at the most specific scope (resource, not subscription). `Owner` is a code smell.

### 7.4 Federated credentials (workload identity for external systems)

If your container app needs to authenticate to systems outside Azure (GitHub, AWS, GCP, on-prem identity providers) without storing secrets, use federated identity credentials on a user-assigned identity. The app gets an Azure AD token; the external system trusts that token via OIDC federation.

### 7.5 Identity for KEDA scalers

KEDA scale rules can use the same managed identity (`identity: 'system'` or `identity: '<resource-id>'`). One identity → app code accesses Service Bus, *and* the scaler watches the queue depth. Single trust path.

---

<a id="8-secrets"></a>
## 8. Secrets Management

ACA gives you three options. They're not interchangeable.

### 8.1 The three options

| Option | Where the secret lives | Use case |
|---|---|---|
| **App secrets (inline)** | Stored in the app definition in Azure | Simple cases, dev environments, secrets that change rarely |
| **Key Vault references** | In Key Vault, fetched by ACA at runtime | Production. Single source of truth. Rotation handled at Key Vault. |
| **App-fetched at runtime** | Your code calls Key Vault directly via SDK with managed identity | When you need rotation without an app restart, or fine-grained access |

### 8.2 Key Vault references — the production default

```bicep
secrets: [
  {
    name: 'db-password'
    keyVaultUrl: 'https://my-kv.vault.azure.net/secrets/db-password'
    identity: '<user-assigned-identity-resource-id>'
  }
]
```

Then the secret can be referenced by environment variable:

```bicep
env: [
  { name: 'DB_PASSWORD', secretRef: 'db-password' }
]
```

The identity must have `Key Vault Secrets User` on the vault.

When a secret rotates in Key Vault, ACA picks it up — but **only on revision restart**. For zero-restart rotation, fetch via SDK from your app code.

### 8.3 Secrets that should never be ACA secrets

- Long-lived database passwords (use entra-auth / managed identity to the DB)
- Long-lived API keys to Azure services (use managed identity)
- Anything with a Key Vault native equivalent

Reach for ACA secrets only for credentials to systems that genuinely need a static credential.

### 8.4 ACR pull credentials

Don't use admin user / password on ACR. Grant your container app's managed identity `AcrPull` on the registry, and reference the identity in `configuration.registries[].identity`. No secret needed.

---

<a id="9-registry"></a>
## 9. Container Registry Integration

### 9.1 Use Azure Container Registry

Public images (Docker Hub) hit rate limits and aren't governable. Use ACR for everything in production. Consider `Premium` SKU for:
- Geo-replication (lower latency for multi-region deployments)
- Private endpoints (no public registry exposure)
- Customer-managed keys (compliance)
- Trust policies and image signing

### 9.2 ACR Tasks for builds

ACR Tasks builds images directly inside Azure — no GitHub Actions runners or self-hosted agents needed for the build step. Useful when:
- You want to keep the build close to the registry (faster push)
- You need cron-triggered rebuilds against base image updates
- You don't want to manage build infrastructure

### 9.3 Image signing and policy

ACR supports Notary/Notation v2 for signing. Pair with:
- **Continuous patching** in ACR (auto-rebuilds your images with patched base images)
- **Defender for Containers** scanning at registry push
- Admission controls in your pipeline that block unsigned or vulnerable images

### 9.4 Image pull strategy

Pull is on cold start. Implications:
- Smaller images = faster scale-up. Apply all the lessons from the Docker playbook here: distroless, multi-stage, layer ordering.
- Geo-replicate if you have apps in multiple regions; the latency to a same-region replica is meaningful at p99.
- Cache hits matter: BuildKit cache export to a registry tag so subsequent CI runs don't rebuild from scratch.

---

<a id="10-jobs"></a>
## 10. Jobs

ACA Jobs are first-class — they're not just "apps that exit." Use them.

### 10.1 The three job types

| Type | Trigger | Use case |
|---|---|---|
| **Manual** | Started by API/CLI/portal | One-off tasks, migrations, on-demand scripts |
| **Schedule** | Cron expression | Periodic batch (nightly ETL, hourly aggregation) |
| **Event** | KEDA `ScaledJob` (queue, blob, etc.) | Per-message processing where each message kicks off an isolated execution |

### 10.2 Jobs vs Apps for queue processing

This is the key choice. Two valid patterns:

**App with queue scaler (ScaledObject):**
- Long-running replicas process messages continuously
- Replica count scales with queue depth
- Better for high-throughput, low-per-message overhead

**Event-driven job (ScaledJob):**
- Each event (or batch) runs in a fresh execution
- Crash isolation between messages
- Better for poison-message tolerance, expensive-per-message work, or work that must run to completion before the next starts

Mental model: ScaledObject is "many workers competing on a queue"; ScaledJob is "one isolated execution per work unit."

### 10.3 Job retry and timeout

Configure both:

```bicep
properties: {
  configuration: {
    triggerType: 'Event'
    replicaTimeout: 1800              // hard timeout: 30 min
    replicaRetryLimit: 3
    eventTriggerConfig: { ... }
  }
}
```

Without `replicaTimeout`, a hung job execution runs until billing makes you notice. Always set it.

### 10.4 Job execution history

Job executions are visible in the portal and via the API. Pipe their logs to Log Analytics. Keep enough history to investigate failures without blowing up Log Analytics ingestion costs.

---

<a id="11-dapr"></a>
## 11. Dapr (When It Helps, When It's Overkill)

Dapr (Distributed Application Runtime) is built into ACA. You enable it per app. It runs as a sidecar and exposes APIs over HTTP/gRPC for cross-cutting microservice concerns.

### 11.1 What Dapr actually gives you

- **Service invocation** with mTLS and retries between Dapr-enabled apps
- **State management** with pluggable backing stores (Redis, Cosmos, etc.)
- **Pub/sub** abstraction over Service Bus / Event Hubs / Kafka
- **Bindings** for input/output to external systems
- **Secrets** abstraction over Key Vault and others
- **Workflow** API for durable, long-running orchestrations
- **Configuration** API
- **Distributed locks**

### 11.2 When it's worth it

- You have many microservices and want to standardize service-to-service communication patterns.
- You want pub/sub with the option to swap brokers without touching app code.
- You need durable workflows and don't want to code them by hand.
- You like the operational benefit of mTLS and retries without writing them.

### 11.3 When it's overkill

- A handful of services where direct HTTP calls are fine.
- A team that hasn't yet learned ACA itself — Dapr is another concept layer.
- Latency-critical paths where the sidecar hop matters (it's usually negligible, but measure).

### 11.4 The honest tradeoff

Dapr is genuinely useful for the patterns it covers, but it adds a sidecar (CPU/memory cost), an API surface to learn, and a new mental model. Adopt incrementally — pubsub is usually the first compelling use case. Don't enable it "in case we need it later" — empty Dapr just adds overhead.

---

<a id="12-observability"></a>
## 12. Observability

### 12.1 The three data planes

ACA gives you:

1. **Container console logs** — stdout/stderr from your containers, routed to Log Analytics (`ContainerAppConsoleLogs_CL`).
2. **System logs** — platform events (scaling decisions, probe failures, image pulls) in `ContainerAppSystemLogs_CL`.
3. **Metrics** — standard Azure Monitor metrics (CPU, memory, requests, replicas) accessible via Metrics Explorer.

### 12.2 Log Analytics setup

- One Log Analytics workspace per environment (or per environment-tier across regions, depending on cost vs simplicity tradeoff).
- Consider a **dedicated cluster** for high-volume environments — bulk ingestion discount kicks in around ~100 GB/day.
- Set retention deliberately. Default 30 days is enough for most ops; compliance may push it to 90+. Archive tier is dramatically cheaper for "we might need it for an audit" data.

### 12.3 The managed OpenTelemetry agent

ACA has a **managed OTel agent** in GA. It runs at the environment level at no extra compute cost. You configure it once on the environment, it accepts OTLP from your app, and routes to:
- Azure Monitor Application Insights (logs, traces)
- Datadog (metrics, logs, traces)
- Any OTLP-compatible endpoint (logs, metrics, traces)

Limitations to know:
- gRPC only (not HTTP).
- Single replica, not HA — if you have strict availability requirements for the telemetry pipeline itself, run your own collector.
- Configuration is environment-wide; you can't route different apps to different destinations.
- App Insights endpoint doesn't accept metrics (route metrics to Azure Monitor metrics or another OTLP endpoint).

### 12.4 Application Insights — the recommended path

For most teams: instrument your apps with the **Azure Monitor OpenTelemetry Distro** (the SDK) and either (a) point at App Insights directly, or (b) emit OTLP to the managed agent and have the agent forward to App Insights.

The Distro gives you:
- Auto-instrumentation for popular libraries
- Live Metrics
- Microsoft Entra auth (no instrumentation key in env vars)
- Standard App Insights tables in Log Analytics

### 12.5 What to actually monitor

- **Replica count** vs `maxReplicas` — are you bumping ceilings?
- **Cold start frequency** — `ContainerAppSystemLogs_CL` shows scale events
- **Scaler errors** — if KEDA can't read the trigger source, scaling silently breaks
- **Probe failures** — readiness failures cause traffic flapping; liveness failures cause restart loops
- **Request error rate by revision** — catches bad deploys before traffic-shift completes
- **Egress data** — surprise data charges from chatty apps

### 12.6 Useful KQL queries

```kusto
// Scale events for a specific app
ContainerAppSystemLogs_CL
| where ContainerAppName_s == "myapp"
| where Log_s contains "scale"
| order by TimeGenerated desc

// Failed probes
ContainerAppSystemLogs_CL
| where Log_s contains "probe" and Log_s contains "failed"
| project TimeGenerated, ContainerAppName_s, Log_s

// p95 latency by revision
requests
| where cloud_RoleName == "myapp"
| summarize p95=percentile(duration, 95) by RevisionName=tostring(customDimensions.RevisionName), bin(timestamp, 5m)
| render timechart
```

### 12.7 Alerts

At minimum, alert on:
- Replicas at `maxReplicas` for >5 minutes (load test or runaway, either way investigate)
- Restart count anomalies
- 5xx rate by revision
- Failed probe ratio
- Scaler errors

Send to Action Groups → Teams / PagerDuty / Logic Apps.

---

<a id="13-cost"></a>
## 13. Cost Optimization

ACA pricing is consumption-driven on the Consumption profile and provisioned on Dedicated. Understanding the model is half the battle.

### 13.1 What you actually pay for (Consumption)

Per-replica:
- **Active vCPU-seconds** (when replica is processing)
- **Active memory GB-seconds**
- **Idle vCPU-seconds** (when replica exists but isn't processing — cheaper rate)
- **Requests** (per million)

Plus environment-level:
- Standard Load Balancers (1 for external, 2 for internal)
- Public IPs for egress (always) and ingress (external environments)
- Log Analytics ingestion
- VNet data processing if applicable

The Consumption price-per-second is *low* but it adds up at sustained load. The Dedicated price is fixed-per-node-per-hour.

### 13.2 The breakeven question

Rough rule of thumb: if a workload runs the equivalent of one always-on 1 vCPU / 2 GB replica, Dedicated profiles often beat Consumption. With multiple apps sharing a Dedicated node (workload profiles let you do this), the math shifts further toward Dedicated.

Build a spreadsheet for your real workload mix; don't trust rules of thumb for production sizing.

### 13.3 Cost-saving levers (in priority order)

1. **Right-size CPU and memory.** Most teams over-provision by 2–4× because they sized for local dev. Measure p95 actual usage, add 30% headroom, drop to the next tier down.
2. **Set `minReplicas = 0` where latency permits.** Dev, staging, internal tools, batch workers between runs.
3. **Set a sane `maxReplicas`.** A runaway scale-out under attack or buggy scaler can cost real money. Cap it.
4. **Mix Consumption and Dedicated** based on workload steadiness. Steady state on dedicated, spiky on consumption.
5. **Geo-replicate ACR only to active regions.** Don't replicate to regions you don't deploy to.
6. **Tame Log Analytics ingestion.** App console logs balloon fast. Sample noisy logs at the SDK level. Use Basic Logs tier for high-volume tables you only query occasionally.
7. **Filter telemetry.** App Insights sampling, span filtering at the OTel collector. Healthcheck endpoints alone can be 30%+ of trace volume.
8. **Reserved Instances on Dedicated** if your dedicated profile usage is steady (1-year and 3-year terms available).

### 13.4 Cost surprises to watch for

- **Egress data**: outbound data over the public internet is metered. A chatty app with public dependencies (think calling a partner API at high RPS) racks up bytes.
- **Cross-region traffic**: if your DB is in one region and apps in another, every query crosses the region boundary at a price.
- **Log Analytics**: easy to ingest 50+ GB/day from a moderately busy environment if every request logs verbosely.
- **Public IPs you're not using**: an unused environment still has its load balancer and IP costs. Tear down dev environments at end of day.

### 13.5 Tagging and showback

Tag every resource with: cost center, owner, environment, application. Use Cost Management + Budgets. Budget alerts catch surprises before the month-end bill does.

---

<a id="14-reliability"></a>
## 14. Reliability and Resiliency

### 14.1 Inside a region

- **Zone redundancy** at the environment level (set at creation, immutable).
- **`minReplicas >= 2`** (ideally 3) on production apps so replicas spread across zones.
- **Probes** correctly configured so failures lead to replacement.
- **Resource limits** prevent one app from starving neighbors on a Dedicated profile.
- **Graceful shutdown** with proper SIGTERM handling — see the Docker playbook.

### 14.2 Across regions

ACA itself is regional. For multi-region:

```
Front Door / Traffic Manager
   ↓
Region A: ACA Environment + dependencies   (active)
Region B: ACA Environment + dependencies   (active or warm-standby)
```

Patterns:
- **Active/active with Front Door** — global routing, automatic failover. Best for stateless front-ends.
- **Active/passive** — secondary region scaled to zero or minimal capacity. Cheaper but failover testing is critical.
- **Read replicas** — primary region writes, both regions read.

### 14.3 The hard part: stateful dependencies

Going multi-region forces you to confront state replication: Cosmos (multi-region writes built in), SQL geo-replication, Storage GZRS/RA-GZRS, Service Bus geo-DR. The compute layer (ACA) is the easy part.

### 14.4 Resiliency policies

ACA supports per-app resiliency policies for service invocation: timeouts, retries, circuit breakers. Configure them rather than relying on the SDK in each language to do retries identically. Apply at the platform layer, get consistency for free.

### 14.5 Backup and disaster recovery

- IaC for everything. Recovery is "redeploy from main" if the templates are good.
- Persistent state lives outside ACA (Azure Files mount, attached database) — back those up via the underlying service, not ACA.
- Test restore quarterly. A backup you haven't restored is a hope.

---

<a id="15-security"></a>
## 15. Security and Governance

### 15.1 The defense-in-depth checklist

- **Network**: internal environment, private endpoints to PaaS dependencies, App Gateway / Front Door with WAF for public ingress.
- **Identity**: managed identity for all Azure resource access, no connection strings, least-privilege RBAC at scoped resources.
- **Secrets**: Key Vault references for any secret that does have to exist; rotation handled at the source.
- **Image**: signed and scanned (Defender for Containers), pulled from private ACR with managed identity.
- **Runtime**: peer-to-peer encryption inside the environment, TLS termination at ingress, application-level authn/authz.
- **Audit**: diagnostic settings to Log Analytics for the environment and the Key Vault and the registry.

### 15.2 Defender for Containers

Enable it. It's an Azure Defender plan that:
- Scans images in ACR on push and continuously
- Watches for runtime anomalies (the K8s-derived layer beneath ACA)
- Surfaces findings in Microsoft Defender for Cloud

### 15.3 Azure Policy

Enforce baseline policies at the management group or subscription level:

- "Container Apps environments should disable public network access" (for environments that should be private)
- "Container Apps should use managed identity for ACR pull"
- "Container Apps should use Key Vault for secrets"
- "Diagnostic settings must be configured"
- "TLS minimum version: 1.2"

Ship a policy initiative as part of your landing zone, not as an afterthought.

### 15.4 Authentication at the edge

ACA has **built-in authentication** (the same EasyAuth feature App Service uses): plug in Microsoft Entra, Google, GitHub, Apple, Twitter, OpenID Connect providers and the platform handles login flows before traffic reaches your app.

For B2B/internal apps, this is an enormous time-saver. For complex auth (custom claims, conditional access enforcement at the app layer), instrument your app properly with MSAL.

### 15.5 RBAC for the ACA control plane

Two things to think about:

- **Plane separation**: who can deploy a new revision (`Contributor` on the app) vs who can change networking (`Contributor` on the environment) vs who can read logs (`Log Analytics Reader`). Custom roles are worth creating.
- **JIT access** via Privileged Identity Management for production. Standing access to production should be minimal.

### 15.6 No privileged containers, ever

ACA doesn't allow privileged containers. This is a feature, not a bug. If your application needs privileged mode, it's the wrong shape for ACA — fix the app or use AKS.

---

<a id="16-iac"></a>
## 16. Infrastructure as Code

Click-ops in the portal is fine for learning. Production must be IaC.

### 16.1 The options

- **Bicep** — Azure-native, terse, IDE support is excellent, what-if previews. Default for Azure-only shops.
- **Terraform (AzureRM provider)** — multi-cloud or already-Terraform shops. Mature but lags behind Bicep on day-1 ACA features.
- **Terraform (AzAPI provider)** — for ACA features not yet in AzureRM. Common pairing.
- **Pulumi** — code-first IaC. Less common but valid.
- **`azd` (Azure Developer CLI)** — opinionated higher-level tool that wraps Bicep. Good for greenfield "I have an app, deploy it to Azure" experience.

### 16.2 What to template

Everything. Specifically:

- The environment (with workload profiles, VNet integration, Log Analytics workspace association)
- Each container app (with template, scale rules, ingress, identity, secrets)
- Each job
- The ACR
- The Key Vault and access (RBAC assignments)
- The user-assigned identities and federated credentials
- Log Analytics workspace and diagnostic settings
- Front Door / App Gateway / private endpoints / DNS zones if applicable

### 16.3 Module structure

Resist mega-templates. Modular Bicep:

```
infra/
  main.bicep                  # top-level orchestration
  modules/
    containerAppEnv.bicep
    containerApp.bicep
    job.bicep
    networking.bicep
    monitoring.bicep
    identity.bicep
  parameters/
    dev.parameters.json
    staging.parameters.json
    prod.parameters.json
```

Per-environment parameter files differ on counts, SKUs, and replica caps — not on resource shape.

### 16.4 Image tags in IaC

Don't hard-code image tags in the template. Pass them as parameters from CI:

```bicep
param imageTag string

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  properties: {
    template: {
      containers: [{
        image: '${acrName}.azurecr.io/myapp:${imageTag}'
        ...
      }]
    }
  }
}
```

CI runs `az deployment group create --parameters imageTag=$GITHUB_SHA`.

### 16.5 What-if before apply

```bash
az deployment group what-if \
  --resource-group rg-prod \
  --template-file main.bicep \
  --parameters @prod.parameters.json
```

Production deploys go through what-if + manual approval. Always.

---

<a id="17-cicd"></a>
## 17. CI/CD

### 17.1 The pipeline shape

A production pipeline does, in order:

1. Build and unit-test
2. Build container image (multi-arch if needed)
3. Vulnerability scan + SBOM + sign
4. Push to ACR (tagged with git SHA + semver)
5. `what-if` against the IaC for the target environment
6. Deploy IaC (creates new revision pointing at new image)
7. Smoke test the new revision via its labeled URL
8. Shift traffic incrementally (10% → 50% → 100%) with health checks between
9. Mark old revisions inactive after a soak period

### 17.2 GitHub Actions example sketch

```yaml
name: Deploy to ACA
on:
  push:
    branches: [main]

permissions:
  id-token: write       # OIDC to Azure
  contents: read
  packages: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: azure/login@v2
        with:
          client-id:       ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id:       ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: ACR login via OIDC
        run: az acr login --name ${{ vars.ACR_NAME }}

      - name: Build & push
        run: |
          docker buildx build \
            --platform linux/amd64 \
            -t ${{ vars.ACR_NAME }}.azurecr.io/myapp:${{ github.sha }} \
            --provenance=mode=max --sbom=true \
            --push .

      - name: Trivy scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ vars.ACR_NAME }}.azurecr.io/myapp:${{ github.sha }}
          severity: CRITICAL,HIGH
          exit-code: '1'
          ignore-unfixed: true

      - name: What-if
        run: |
          az deployment group what-if \
            --resource-group rg-prod \
            --template-file infra/main.bicep \
            --parameters @infra/parameters/prod.parameters.json \
            --parameters imageTag=${{ github.sha }}

      - name: Deploy (creates new revision at 0% traffic)
        run: |
          az deployment group create \
            --resource-group rg-prod \
            --template-file infra/main.bicep \
            --parameters @infra/parameters/prod.parameters.json \
            --parameters imageTag=${{ github.sha }}

      - name: Smoke test canary URL
        run: ./scripts/smoke-test.sh https://myapp---canary.<env>.<region>.azurecontainerapps.io

      - name: Shift traffic to 100%
        run: |
          az containerapp ingress traffic set \
            --name myapp --resource-group rg-prod \
            --revision-weight latest=100
```

### 17.3 OIDC federation, not service principal secrets

GitHub Actions, Azure DevOps, GitLab — all support federated identity to Azure now. **Do not** create a service principal with a client secret stored in `secrets.AZURE_CLIENT_SECRET`. Use OIDC federation:

- Create a user-assigned managed identity for the deploy pipeline.
- Add a federated credential trusting the GitHub repo / branch / environment.
- Grant the identity `Contributor` on the resource group (or a custom role).

The pipeline gets a short-lived token via OIDC. No long-lived secrets in CI.

### 17.4 Artifact promotion vs rebuild per environment

Build the image **once**, promote it through environments. The dev image is the staging image is the prod image — only configuration (env vars, secrets, scale rules, replica counts) differs per environment.

Rebuilding per environment defeats the point of containers. If your image changes between dev and prod, your dev isn't testing what runs in prod.

---

<a id="18-troubleshooting"></a>
## 18. Troubleshooting Playbook

### 18.1 The Diagnose & Solve blade

ACA has a built-in diagnostics blade in the portal with detectors for common issues: image pull failures, probe failures, KEDA scaler failures, target port misconfiguration, container exit issues. Always check this first — it's faster than poking around logs.

### 18.2 New revision created but not getting traffic

Check:
- `revisionMode` — single mode auto-promotes; multiple mode does not.
- Traffic split in `configuration.ingress.traffic[]`.
- The revision's `provisioningState` and `runningState`.
- Probes — readiness failures will hold the revision out of rotation.

### 18.3 Container won't start

```bash
az containerapp logs show -n myapp -g rg-prod --type=system --follow
az containerapp logs show -n myapp -g rg-prod --type=console --follow
```

Or query Log Analytics:

```kusto
ContainerAppSystemLogs_CL
| where ContainerAppName_s == "myapp"
| order by TimeGenerated desc
| take 50
```

Common causes: image pull failure (registry RBAC), missing env var or secret reference, target port mismatch (ingress port doesn't match what the app listens on), probe failure during startup (use a startup probe with a generous failure threshold).

### 18.4 Scaler isn't scaling

- Run the same KEDA scaler config locally against the trigger source to verify it actually sees the metric.
- Check `ContainerAppSystemLogs_CL` for KEDA error messages.
- For Azure scalers using managed identity: check the identity has the right RBAC on the trigger resource.
- Polling interval: a 30s default polling interval misses fast-burst short-lived workloads.

### 18.5 Cold starts hurt

- Reduce image size aggressively.
- Move expensive init out of the request path (lazy-init, background warm-up).
- Set `minReplicas >= 1`.
- Pre-warm: a `cron` scaler can scale up before known peak times.

### 18.6 Network connectivity issues

For internal environments:
- Private DNS zone with the right wildcard A record at the environment FQDN.
- VNet links from each VNet that needs to resolve.
- NSG rules don't block traffic to/from the ACA subnet.
- For corporate proxies / forced tunneling: ACA needs egress to specific Microsoft endpoints; check the `AzurePlatform*` service tags.

### 18.7 The escape hatch: ACA console exec

The portal has a console feature that exec's into a running replica. Available, useful for desperate moments. Not a substitute for proper observability — anything you find here should drive a fix that makes it findable in logs/metrics next time.

### 18.8 Known gotchas

- **Secrets do not refresh without revision restart** unless your code reads from Key Vault directly via SDK.
- **Functions on ACA + Event Hubs scaling** has known issues with auto-generated KEDA rules — if your Function App on ACA isn't scaling on Event Hub depth, deploy as a regular Container App with explicit KEDA rules instead.
- **Subnet IP exhaustion** at scale — there's no graceful warning; new replicas just fail to schedule.
- **Quota on per-region replicas** — defaults are conservative; raise via support ticket before you need it.

---

<a id="19-anti-patterns"></a>
## 19. Anti-Patterns

| Anti-pattern | Why it's bad |
|---|---|
| Connection strings instead of managed identity | Secret rotation hell; one leak compromises everything |
| Admin user enabled on ACR | Long-lived password in app config; managed identity exists for this |
| `minReplicas = 0` for latency-sensitive APIs | Cold start hits real users |
| `minReplicas = 1` in zone-redundant prod | Defeats zone redundancy entirely |
| Single revision mode in production | No safe rollback path; no canary |
| `latest` tag for image references | Same problems as Docker; revision change semantics break |
| Hardcoded image tag in IaC | Forces template changes for every deploy |
| ACA secrets for things Key Vault can store | Loses central rotation, audit, and access control |
| One env per app | IPs and load balancers cost real money; service discovery breaks |
| External environment exposed without WAF | Front Door / App Gateway with WAF is cheap insurance |
| CPU-based scaling for queue workers | Idle workers look fine; queue grows unbounded |
| No `replicaTimeout` on jobs | Hung jobs run until you notice the bill |
| Click-ops in production | Drift, no audit trail, can't recover from disaster |
| Service principal with client secret in CI | OIDC federation has been GA for years; use it |
| Identical image tag rebuilt per environment | Defeats containers; dev doesn't test what prod runs |
| Logging sensitive values to console | They land in Log Analytics; they're now searchable forever |
| Running an unsupported Linux/arm64 image | ACA is `linux/amd64` only — multi-arch builds must include amd64 |
| Privileged containers, host network | Not supported; if you need them, you need AKS, not ACA |

---

<a id="20-checklist"></a>
## 20. Production Readiness Checklist

A container app is ready for production when:

**Environment**
1. ☐ Workload profiles environment (not Consumption-only)
2. ☐ Zone redundancy enabled
3. ☐ VNet-integrated with appropriately sized subnet
4. ☐ Internal load balancer if no public exposure intended
5. ☐ Log Analytics workspace attached, retention set deliberately
6. ☐ OpenTelemetry agent configured (or app uses App Insights SDK directly)

**Container App**
7. ☐ Multiple-revision mode enabled
8. ☐ `minReplicas >= 2` for production
9. ☐ `maxReplicas` set as a sane cap
10. ☐ Liveness, readiness, AND startup probes configured
11. ☐ Resource limits right-sized from production data, not dev guess
12. ☐ Revision suffix set to git SHA or build number
13. ☐ Graceful shutdown handled in the app (SIGTERM)
14. ☐ Image is small (multi-stage, distroless or alpine)
15. ☐ Image pulled via managed identity, not admin user

**Identity and Secrets**
16. ☐ User-assigned managed identity attached
17. ☐ RBAC granted at scoped resources, not subscription
18. ☐ No connection strings; all Azure access via managed identity
19. ☐ Key Vault references for any required static secret
20. ☐ Federated credentials used for external system trust

**Networking**
21. ☐ Ingress visibility correct (External / VNet / Environment-only)
22. ☐ TLS via managed certificate or Key Vault-backed cert
23. ☐ Custom domain DNS verified and CNAME pointing correctly
24. ☐ Private endpoints to PaaS dependencies (Storage, KV, SQL) where applicable
25. ☐ NAT Gateway or UDR for predictable egress, if required

**Scaling**
26. ☐ Scale rules match the workload (HTTP / queue depth / event lag — not CPU for queue workers)
27. ☐ Scaler authenticates via managed identity
28. ☐ `pollingInterval` and `cooldownPeriod` tuned for the workload pattern

**Observability**
29. ☐ Diagnostic settings sending to Log Analytics
30. ☐ App Insights or OTel destination configured with Distro/SDK
31. ☐ Alerts: max-replicas-reached, 5xx rate, probe failures, scaler errors
32. ☐ Dashboards saved and shared

**Operational**
33. ☐ Everything in IaC (Bicep / Terraform); no portal-only resources
34. ☐ CI uses OIDC federation, not stored client secrets
35. ☐ Image scanned and signed; SBOM generated
36. ☐ Defender for Containers enabled on the subscription
37. ☐ Azure Policy enforces the baseline (no public access, managed identity required, diagnostics required)
38. ☐ Cost budget configured with alert thresholds
39. ☐ Tags applied consistently (cost center, owner, environment, application)
40. ☐ Runbook documented: deploy steps, rollback, who to call

When all 40 are checked, you're operating ACA, not just running it.

---

## Further Reading

- [Azure Container Apps overview](https://learn.microsoft.com/azure/container-apps/overview)
- [Well-Architected Framework: Container Apps service guide](https://learn.microsoft.com/azure/well-architected/service-guides/azure-container-apps)
- [KEDA scalers reference](https://keda.sh/docs/scalers/)
- [Container Apps landing zone accelerator](https://learn.microsoft.com/azure/cloud-adoption-framework/scenarios/app-platform/container-apps/landing-zone-accelerator)
- [Dapr on Azure Container Apps](https://learn.microsoft.com/azure/container-apps/dapr-overview)
- [Container Apps roadmap on GitHub](https://github.com/microsoft/azure-container-apps)

---

*Last reviewed: May 2026. ACA evolves rapidly — features that were preview six months ago are GA now, and the breakeven math on Consumption vs Dedicated changes with pricing updates. Revisit quarterly.*
