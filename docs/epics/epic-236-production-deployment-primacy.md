# Epic 236: Node.js Production Deployment Primacy

## Goal

Shift documentation, code comments, and developer experience to treat the Node.js + PostgreSQL self-hosted deployment as the **primary production path**, with Cloudflare Workers clearly marked as the **demo/evaluation deployment**. Currently, many docs and code paths frame CF as primary, which misrepresents the actual deployment story for production operators.

## Context

The architecture audit (2026-03-03) found:

- **Node.js platform is fully implemented** (Epic 55 complete) but docs still say things like "CF Workers backend" without qualifying
- **CLAUDE.md** lists CF Workers first in the tech stack, Node.js is mentioned later
- **PROTOCOL.md** audience line doesn't mention self-hosted
- **NEXT_BACKLOG.md** frames CF Workers as the primary backend
- **`bun run dev:worker`** (wrangler dev) is the documented dev workflow — no equivalent `bun run dev:node` for local Node.js development
- **Operator documentation** (QUICKSTART.md, RUNBOOK.md) is excellent but disconnected from the main README/CLAUDE.md narrative
- **Helm chart** and **Docker Compose** are production-ready but feel like afterthoughts in the docs

For a crisis response hotline used by activist organizations, self-hosted is not optional — it's the expected deployment. CF Workers is useful for demos and evaluation, but production operators will use Docker/Kubernetes on EU-jurisdiction VPS providers.

## Implementation

### Phase 1: Documentation Reframing

#### 1.1 CLAUDE.md Tech Stack Section
Reorder to list Node.js first:

```markdown
## Tech Stack

- **Backend (Production)**: Node.js 20+ with Hono, PostgreSQL 17, MinIO (S3), strfry (Nostr relay)
- **Backend (Demo/Eval)**: Cloudflare Workers + Durable Objects (zero-infra evaluation)
- **Desktop**: Tauri v2 + Vite + TanStack Router + shadcn/ui
...
```

#### 1.2 CLAUDE.md Development Commands
Add Node.js dev commands alongside CF:

```markdown
# Backend (production runtime)
bun run build:node                       # Build Node.js server
bun run start:node                       # Run built server
bun run test:docker:up                   # Start Docker Compose stack
bun run test:docker:down                 # Stop Docker Compose stack

# Backend (demo/evaluation)
bun run dev:worker                       # Wrangler dev server (CF Workers + DOs)
```

#### 1.3 PROTOCOL.md
Update audience line:
```
Audience: Desktop (Tauri), Mobile (Swift & Kotlin), self-hosted operators, and third-party client implementors
```

Add deployment section:
```
## Deployment Models
- **Self-hosted (recommended)**: Node.js + PostgreSQL + MinIO on EU-jurisdiction VPS
- **Cloud evaluation**: Cloudflare Workers (demo deployments, zero-infrastructure evaluation)
```

#### 1.4 README.md (if exists)
Add prominent self-hosted quick start section linking to `docs/QUICKSTART.md`

### Phase 2: Developer Experience

#### 2.1 Local Node.js Dev Server

Add `bun run dev:node` script that:
1. Starts PostgreSQL + MinIO via Docker Compose (services only, not the app)
2. Builds Node.js server with esbuild (watch mode)
3. Runs the server with hot reload (e.g., `node --watch dist/server/index.js`)
4. Connects to local PostgreSQL and MinIO

This gives developers a way to develop against the production runtime locally, not just wrangler.

#### 2.2 Dev Environment Detection

Add `scripts/dev-setup-node.sh`:
- Checks for Docker, PostgreSQL, MinIO
- Creates `.env` from `.env.example` with generated secrets
- Runs initial migration
- Prints connection info

### Phase 3: Architecture Diagrams

#### 3.1 Update docs/ARCHITECTURE.md

Add clear deployment topology diagrams:

```
Production (Self-Hosted):
┌─────────┐     ┌──────────┐     ┌─────────┐
│ Desktop  │────▶│ Node.js  │────▶│PostgreSQL│
│ Clients  │     │ (Hono)   │────▶│  MinIO   │
│ Mobile   │     │          │────▶│  strfry  │
└─────────┘     └──────────┘     └─────────┘
                     │
                ┌────▼────┐
                │  Caddy   │ (TLS termination)
                └─────────┘

Demo (Cloudflare):
┌─────────┐     ┌──────────┐
│ Desktop  │────▶│ CF Worker│ (DOs = in-memory KV)
│ Clients  │     │          │ (R2 = blob storage)
└─────────┘     └──────────┘
```

### Phase 4: Deployment Template Improvements

#### 4.1 One-Command Demo Deploy
```bash
# For evaluators who just want to see it work:
docker compose up -d
# → PostgreSQL, MinIO, strfry, app all start
# → Auto-generates secrets on first run
# → Prints admin bootstrap command
```

#### 4.2 Production Checklist
Add `deploy/PRODUCTION_CHECKLIST.md`:
- [ ] EU-jurisdiction VPS provisioned
- [ ] PostgreSQL with encrypted storage
- [ ] TLS certificates (Caddy auto or manual)
- [ ] Secrets generated and stored securely
- [ ] Backup schedule configured
- [ ] Monitoring/alerting set up
- [ ] Admin keypair bootstrapped
- [ ] Telephony provider configured

## Verification

1. CLAUDE.md tech stack section lists Node.js before CF Workers
2. `bun run dev:node` starts a working local dev server against PostgreSQL
3. All documentation frames self-hosted as the recommended production path
4. CF Workers is clearly labeled as demo/evaluation in all docs
5. New developer can follow QUICKSTART.md end-to-end without touching CF

## Dependencies

- Epic 55 (Multi-Platform Deployment) — COMPLETE
- Epic 66 (Deployment Hardening Tooling) — COMPLETE
- Epic 235 (Node.js E2E Test Parity) — should run in parallel

## Risk

- **Low**: Existing CF-focused developers may need to adjust workflow
- **Low**: CF Workers deployment still works (no changes to CF code, just docs)
