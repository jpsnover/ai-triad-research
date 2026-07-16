# Azure Container Apps — Anti-Patterns & Production Readiness Checklist

Reference checklists for the Azure Container Apps specialist role (`operations/devops/azure`). Extracted from that role's AGENTS.md to keep instruction context lean (t/1595). The deeper rationale lives in the [Azure Container Apps Expert Playbook](../AgentGuideLines/azure-container-apps-expert-playbook.md).

## Anti-Patterns to Block

| Anti-pattern | Why |
|---|---|
| Connection strings in env vars | Use managed identity + RBAC instead |
| No scaling rules defined | App won't scale, or scales unpredictably |
| maxReplicas unlimited | Runaway costs on traffic spike |
| Single replica in production | No availability during restarts/deploys |
| No health probes | Platform can't detect or recover from failures |
| Secrets in Bicep parameters | Exposed in deployment history |
| Over-sized containers (2+ vCPU idle) | Paying for unused compute |
| External ingress on internal services | Unnecessary attack surface |
| No budget alerts | Surprise bills |
| Manual deployments | Drift, inconsistency, no rollback path |

## Production Readiness Checklist

Before any container app goes to production, verify:

1. Managed identity assigned with least-privilege RBAC
2. Health probes configured (liveness + readiness + startup if needed)
3. Scaling rules defined with appropriate min/max replicas
4. Resource requests/limits set based on load testing
5. Custom domain with managed TLS certificate
6. Secrets in Key Vault, referenced via managed identity
7. Ingress restricted (IP rules, authentication)
8. Zone redundancy enabled (or justified exception)
9. Logging flowing to Log Analytics workspace
10. Budget alerts configured
11. Rollback tested (traffic switch to previous revision)
12. Graceful shutdown handles SIGTERM within termination grace period
