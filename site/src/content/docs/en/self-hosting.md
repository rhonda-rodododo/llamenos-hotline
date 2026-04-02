---
title: Self-Hosting Overview
description: Deploy Llamenos on your own infrastructure with Docker Compose or Kubernetes.
---

Llamenos is designed to run on your own infrastructure. Self-hosting gives you full control over data residency, network isolation, and infrastructure choices — critical for organizations protecting against well-funded adversaries.

## Deployment options

| Option | Best for | Complexity | Scaling |
|--------|----------|------------|---------|
| [Docker Compose](/docs/deploy-docker) | Single-server, recommended start | Low | Single node |
| [Kubernetes (Helm)](/docs/deploy-kubernetes) | Multi-service orchestration | Medium | Horizontal (multi-replica) |
| [Co-op Cloud](/docs/deploy-coopcloud) | Co-op hosting collectives | Low | Single node (Swarm) |

## Docker Compose files

Docker Compose uses a layered approach:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base configuration — all services, networks, volumes |
| `docker-compose.production.yml` | Production overlay — TLS via Let's Encrypt, log rotation, resource limits, strict CSP |
| `docker-compose.test.yml` | Test overlay — exposes app port directly, development mode |

For **local development**, use the base file only. For **production**, stack the production overlay:

```bash
# Local
docker compose -f docker-compose.yml up -d

# Production
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

Or use the setup script, which handles this automatically:

```bash
./scripts/docker-setup.sh                                     # local
./scripts/docker-setup.sh --domain hotline.org --email a@b    # production
```

## Architecture

All deployment options run the **exact same application code**. The difference is in the infrastructure layer:

| Component | Technology |
|-----------|------------|
| **Backend runtime** | Bun + Hono |
| **Data storage** | PostgreSQL |
| **Blob storage** | RustFS (S3-compatible) |
| **Transcription** | Client-side Whisper (WASM) — audio never leaves browser |
| **Static files** | Caddy / Hono serveStatic |
| **Real-time events** | Nostr relay (strfry) |
| **TLS termination** | Caddy (automatic HTTPS) |

## What you need

### Minimum requirements

- A Linux server (2 CPU cores, 2 GB RAM minimum)
- Docker and Docker Compose v2 (or a Kubernetes cluster for Helm)
- A domain name pointing to your server
- `openssl` (for generating secrets during setup)
- At least one communication channel (voice provider, SMS, etc.)

### Optional components

- **Whisper transcription** — requires 4 GB+ RAM (CPU) or a GPU for faster processing
- **Asterisk** — for self-hosted SIP telephony (see [Asterisk setup](/docs/setup-asterisk))
- **Signal bridge** — for Signal messaging (see [Signal setup](/docs/setup-signal))

## Quick comparison

**Choose Docker Compose if:**
- You're running on a single server or VPS
- You want the simplest possible self-hosted setup
- You're comfortable with Docker basics

**Choose Kubernetes (Helm) if:**
- You already have a K8s cluster
- You need horizontal scaling (multiple replicas)
- You want to integrate with existing K8s tooling (cert-manager, external-secrets, etc.)

**Choose Co-op Cloud if:**
- You're part of a tech co-op or hosting collective
- You already use Docker Swarm + Traefik via abra
- You want standardized recipe management with `abra` CLI
- You need integrated backup via backupbot

## Security considerations

Self-hosting gives you more control but also more responsibility:

- **Data at rest**: PostgreSQL data is stored unencrypted by default. Use full-disk encryption (LUKS, dm-crypt) on your server, or enable PostgreSQL TDE if available. Note that call notes and transcriptions are already E2EE — the server never sees plaintext.
- **Network security**: Use a firewall to restrict access. Only ports 80/443 should be publicly accessible.
- **Secrets**: Never put secrets in Docker Compose files or version control. Use `.env` files (excluded from images) or Docker/Kubernetes secrets.
- **Updates**: Pull new images regularly. Watch the [changelog](https://github.com/rhonda-rodododo/llamenos/blob/main/CHANGELOG.md) for security fixes.
- **Backups**: Back up the PostgreSQL database and RustFS storage regularly. See the backup section in each deployment guide.

## Next steps

- [Getting Started](/docs/getting-started) — quick start with Docker
- [Docker Compose deployment](/docs/deploy-docker) — full production deployment guide
- [Kubernetes deployment](/docs/deploy-kubernetes) — deploy with Helm
- [Co-op Cloud deployment](/docs/deploy-coopcloud) — deploy with abra
