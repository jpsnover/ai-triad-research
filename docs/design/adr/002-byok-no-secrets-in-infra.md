# ADR-002: BYOK model — no secrets in infrastructure

**Status:** accepted
**Date:** 2026-04-08
**Author:** Technical Lead

## Context

The platform uses multiple AI backends (Gemini, Claude, Groq, OpenAI, DeepSeek). Embedding API keys in infrastructure (Docker images, Bicep templates, environment variables baked into config files) creates security risk, complicates key rotation, and limits users to the project's own quotas.

## Decision

Bring Your Own Key (BYOK): users provide their own API keys through the application UI. Keys are never stored in infrastructure.

Three tiers of key management:

| Tier | Source | Storage |
|------|--------|---------|
| Platform | Server-side (project-owned) | Azure Key Vault via managed identity |
| BYOK | User-provided via UI | Browser `sessionStorage` (never persisted server-side) |
| Free | Server-side (dedicated account) | Environment variable (`FREE_TIER_*_KEY`) |

- `.env.example` documents all variables with placeholder values, never real secrets
- Docker images contain zero secrets
- Key rotation requires only an env var update + redeploy
- Error messages must never leak key values

## Consequences

- Users control their own costs and quotas
- No shared API key to protect or rotate project-wide
- Key Vault costs are minimal (only platform-tier keys, not per-user)
- Users must bring a key to use non-free-tier models — increases onboarding friction
- BYOK keys in `sessionStorage` are lost on browser close — acceptable tradeoff for security
