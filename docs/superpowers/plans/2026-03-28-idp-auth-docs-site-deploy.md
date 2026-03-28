# Plan: IdP Auth — Docs Site Deployment Guides

**Status**: Not started
**Branch**: feat/idp-auth-hardening
**Context**: All 4 deployment guides (Docker, Kubernetes, Co-op Cloud, self-hosting overview) have MinIO references and no IdP/Authentik documentation. These are user-facing — operators follow them to deploy.

## Scope

All files under `site/src/content/docs/en/`:
- `deploy-docker.md` — Primary deployment guide
- `deploy-kubernetes.md` — Helm-based K8s deployment
- `deploy-coopcloud.md` — Co-op Cloud (Docker Swarm)
- `self-hosting.md` — Overview and architecture comparison

## Cross-Cutting Changes (apply to ALL deploy guides)

### MinIO → RustFS
Every deployment guide references MinIO. Replace:
- Service name: `minio` → `rustfs`
- Image: `minio/minio` → `rustfs/rustfs`
- Env vars: `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` → `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`
- Bucket config: `MINIO_BUCKET` → removed (app creates per-hub buckets automatically)
- Backup commands: Update S3 CLI references

### Add Authentik as Core Service
- Add `authentik-server` and `authentik-worker` to services list/table
- Document Authentik health check URL: `http://authentik:9000/-/health/ready/`
- Note first-boot time (~60s for migrations + blueprint apply)
- Document blueprint provisioning (auto-configured via mounted YAML)

### Add IdP Secret Generation
Add to secrets setup section:
```bash
JWT_SECRET=$(openssl rand -hex 32)
IDP_VALUE_ENCRYPTION_KEY=$(openssl rand -hex 32)
AUTHENTIK_SECRET_KEY=$(openssl rand -hex 32)
AUTHENTIK_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)
```

### Add WebAuthn Configuration
Document `AUTH_WEBAUTHN_RP_ID`, `AUTH_WEBAUTHN_RP_NAME`, `AUTH_WEBAUTHN_ORIGIN` — derived from domain.

## Per-File Tasks

### 1. deploy-docker.md
- [ ] Update services table: replace MinIO row with RustFS, add Authentik rows
- [ ] Update "Generate secrets" section with new vars
- [ ] Update `docker-compose.yml` snippet to show Authentik services
- [ ] Add "Authentik Configuration" subsection explaining:
  - Blueprint auto-provisioning
  - First admin account creation via setup wizard
  - How volunteer provisioning works (admin creates → Authentik account auto-created)
- [ ] Update environment variables table with full list including IdP vars
- [ ] Update backup/restore section for RustFS

### 2. deploy-kubernetes.md
- [ ] Replace all MinIO Helm values with RustFS equivalents
- [ ] Add Authentik subchart or external service configuration
- [ ] Add IdP secrets to `helm install` command
- [ ] Update `values.yaml` example with IdP section
- [ ] Remove `bootstrap-admin` Bun prerequisite (setup wizard handles it)
- [ ] Update persistent volume claims for RustFS

### 3. deploy-coopcloud.md
- [ ] Replace MinIO secret/config references with RustFS
- [ ] Add Authentik service to the stack
- [ ] Add IdP secrets to Docker Swarm secret creation
- [ ] Update backup/restore for RustFS

### 4. self-hosting.md
- [ ] Update architecture table: replace "MinIO (S3-compatible)" with "RustFS (S3-compatible)"
- [ ] Add "Identity Provider" row to architecture table
- [ ] Add auth infrastructure to "What you need" section
- [ ] Note hardware requirements for Authentik (512MB RAM minimum)

## Acceptance Criteria
- Zero MinIO references remain in any deployment guide
- Operator can deploy with IdP auth by following any single guide
- All secret generation is documented
- Authentik appears as a core service in all deployment methods
