---
title: "Deploy: Docker Compose"
description: Deploy Llamenos on your own server with Docker Compose.
---

This guide walks you through deploying Llamenos with Docker Compose on a single server. You'll have a fully functional hotline with automatic HTTPS, PostgreSQL database, object storage, identity provider, real-time relay, and optional transcription — all managed by Docker Compose.

## Prerequisites

- A Linux server (Ubuntu 22.04+, Debian 12+, or similar)
- [Docker Engine](https://docs.docker.com/engine/install/) v24+ with Docker Compose v2
- `openssl` (pre-installed on most systems)
- A domain name with DNS pointing to your server's IP

## Quick start (local)

To try Llamenos locally:

```bash
git clone https://github.com/rhonda-rodododo/llamenos.git
cd llamenos
./scripts/docker-setup.sh
```

Visit **http://localhost:8000** and follow the setup wizard to create your admin account.

## Production deployment

```bash
git clone https://github.com/rhonda-rodododo/llamenos.git
cd llamenos
./scripts/docker-setup.sh --domain hotline.yourorg.com --email admin@yourorg.com
```

The setup script:
1. Generates strong random secrets (database password, HMAC key, storage credentials, Nostr relay secret)
2. Writes them to `deploy/docker/.env`
3. Builds and starts all services using the **production Docker Compose overlay** (`docker-compose.production.yml`)
4. Waits for the app to become healthy

The production overlay adds:
- **TLS termination** via Let's Encrypt (Caddy with production Caddyfile)
- **Log rotation** for all services (10 MB max, 5 files)
- **Resource limits** (1 GB memory for the app)
- **Strict CSP** — only `wss://` WebSocket connections (no plain `ws://`)

Visit `https://hotline.yourorg.com` and follow the setup wizard to create your admin account and configure channels.

### Manual setup

If you prefer to configure everything manually instead of using the script:

```bash
cd deploy/docker
cp .env.example .env
```

Edit `.env` and fill in the required secrets. Generate random values:

```bash
# For hex secrets (HMAC_SECRET, SERVER_NOSTR_SECRET):
openssl rand -hex 32

# For passwords (PG_PASSWORD, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY):
openssl rand -base64 24
```

Set your domain and email for TLS certificates:

```env
DOMAIN=hotline.yourorg.com
ACME_EMAIL=admin@yourorg.com
```

Then start the services with the production overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

## Docker Compose files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base configuration — all services, networks, volumes |
| `docker-compose.production.yml` | Production overlay — TLS Caddyfile, log rotation, resource limits |
| `docker-compose.test.yml` | Test overlay — exposes app port, sets development mode |

**Local development** uses only the base file. **Production** stacks the production overlay on top.

## Core services

The setup starts six core services:

| Service | Purpose | Port |
|---------|---------|------|
| **app** | Llamenos application (Bun) | 3000 (internal) |
| **postgres** | PostgreSQL database | 5432 (internal) |
| **caddy** | Reverse proxy + automatic TLS | 8000 (local), 80/443 (production) |
| **rustfs** | S3-compatible file storage (RustFS) | 9000 (internal) |
| **strfry** | Nostr relay for real-time events | 7777 (internal) |
| **authentik** | Identity provider (SSO, invite-based onboarding, MFA) | 9443 (internal) |

Check that everything is running:

```bash
cd deploy/docker
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
docker compose -f docker-compose.yml -f docker-compose.production.yml logs app --tail 50
```

Verify the health endpoint:

```bash
curl https://hotline.yourorg.com/api/health
# {"status":"ok"}
```

## First login

Open your hotline URL in a browser. The setup wizard will guide you through:

1. **Create admin account** — you'll receive an invite link from Authentik. Click the link, set your credentials, and your admin account is provisioned.
2. **Name your hotline** — set the display name
3. **Choose channels** — enable Voice, SMS, WhatsApp, Signal, and/or Reports
4. **Configure providers** — enter credentials for each channel
5. **Review and finish**

## Configure webhooks

Point your telephony provider's webhooks to your domain:

- **Voice (incoming)**: `https://hotline.yourorg.com/api/telephony/incoming`
- **Voice (status)**: `https://hotline.yourorg.com/api/telephony/status`
- **SMS**: `https://hotline.yourorg.com/api/messaging/sms/webhook`
- **WhatsApp**: `https://hotline.yourorg.com/api/messaging/whatsapp/webhook`
- **Signal**: Configure bridge to forward to `https://hotline.yourorg.com/api/messaging/signal/webhook`

See provider-specific guides: [Twilio](/docs/deploy/providers/twilio), [SignalWire](/docs/deploy/providers/signalwire), [Vonage](/docs/deploy/providers/vonage), [Plivo](/docs/deploy/providers/plivo), [Asterisk](/docs/deploy/providers/asterisk).

## Optional: Enable transcription

The Whisper transcription service requires additional RAM (4 GB+):

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile transcription up -d
```

Configure the model in your `.env`:

```env
WHISPER_MODEL=Systran/faster-whisper-base   # or small, medium, large
WHISPER_DEVICE=cpu                           # or cuda for GPU
```

## Optional: Enable Asterisk

For self-hosted SIP telephony (see [Asterisk setup](/docs/deploy/providers/asterisk)):

```bash
# Add credentials to .env first
echo "ARI_PASSWORD=$(openssl rand -base64 24)" >> deploy/docker/.env
echo "BRIDGE_SECRET=$(openssl rand -hex 32)" >> deploy/docker/.env

docker compose -f docker-compose.yml -f docker-compose.production.yml --profile asterisk up -d
```

## Optional: Enable Signal

For Signal messaging (see [Signal setup](/docs/deploy/providers/signal)):

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile signal up -d
```

## Updating

Pull the latest code and rebuild:

```bash
cd /path/to/llamenos/deploy/docker
git -C ../.. pull
docker compose -f docker-compose.yml -f docker-compose.production.yml build
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

Data is persisted in Docker volumes (`postgres-data`, `rustfs-data`, etc.) and survives container restarts and rebuilds.

## Backups

### PostgreSQL

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml exec postgres pg_dump -U llamenos llamenos > backup-$(date +%Y%m%d).sql
```

To restore:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres psql -U llamenos llamenos < backup-20250101.sql
```

### RustFS storage

RustFS stores uploaded files, recordings, and attachments. Use any S3-compatible CLI (e.g., `mc` or `aws s3`) to back up the data, or simply back up the `rustfs-data` Docker volume directly.

### Automated backups

For production, set up a cron job:

```bash
# /etc/cron.d/llamenos-backup
0 3 * * * root cd /opt/llamenos/deploy/docker && docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres pg_dump -U llamenos llamenos | gzip > /backups/llamenos-$(date +\%Y\%m\%d).sql.gz 2>&1 | logger -t llamenos-backup
```

## Monitoring

### Health checks

The app exposes `/api/health`. Docker Compose has built-in health checks for all services. Monitor externally with any HTTP uptime checker.

### Logs

```bash
cd /opt/llamenos/deploy/docker

# All services
docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f

# Specific service
docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f app

# Last 100 lines
docker compose -f docker-compose.yml -f docker-compose.production.yml logs --tail 100 app
```

## Troubleshooting

### App won't start

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml logs app
docker compose -f docker-compose.yml -f docker-compose.production.yml config  # verify .env is loaded
docker compose -f docker-compose.yml -f docker-compose.production.yml ps       # check service health
```

### Certificate issues

Caddy needs ports 80 and 443 open for ACME challenges:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml logs caddy
curl -I http://hotline.yourorg.com
```

## Service architecture

```mermaid
flowchart TD
    Internet -->|":8000 or :80/:443"| Caddy["Caddy<br/>(TLS, reverse proxy)"]
    Caddy -->|":3000"| App["App<br/>(Bun)"]
    Caddy -->|"/nostr"| Strfry["strfry<br/>(Nostr relay)"]
    App --> PostgreSQL[("PostgreSQL<br/>:5432")]
    App --> RustFS[("RustFS<br/>:9000")]
    App --> Authentik["Authentik<br/>(IdP)"]
    App -.->|"optional"| Whisper["Whisper<br/>:8080"]
```

## Next steps

- [Admin Guide](/docs/guides/?audience=operator) — configure the hotline
- [Self-Hosting Overview](/docs/deploy/self-hosting) — compare deployment options
- [Kubernetes Deployment](/docs/deploy/kubernetes) — migrate to Helm
- [QUICKSTART.md](https://github.com/rhonda-rodododo/llamenos/blob/main/docs/QUICKSTART.md) — VPS provisioning and server hardening
