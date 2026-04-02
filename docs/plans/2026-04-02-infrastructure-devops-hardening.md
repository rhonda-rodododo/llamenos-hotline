# Plan: Infrastructure & DevOps Hardening

**Spec:** `docs/specs/2026-04-02-infrastructure-devops-hardening.md`
**Date:** 2026-04-02
**Estimated effort:** 2-3 sessions (~6-8 hours)
**Priority:** High

---

## Phase 1: RustFS Backup

### Step 1.1: Add RustFS Dump to Backup Script
- [ ] **File:** `deploy/ansible/roles/backup/tasks/main.yml`
- [ ] Add step after PostgreSQL dump: use `mc` (MinIO client) or `docker exec rustfs mc mirror` to export all buckets
- [ ] Output: `rustfs-${TIMESTAMP}.tar.gz` (compressed tarball of all bucket contents)
- [ ] Encrypt with `age` using same operator public key
- [ ] Final file: `rustfs-${TIMESTAMP}.tar.gz.age`

### Step 1.2: Update Status Tracking
- [ ] Update `.status.json` to include both `dbSizeBytes` and `blobSizeBytes`
- [ ] Update health endpoint to report both sizes

### Step 1.3: Include in Retention Policy
- [ ] Apply same GFS rotation to RustFS backups (7 daily, 4 weekly, 3 monthly)
- [ ] Include in rclone off-site sync

### Step 1.4: Update Restore Playbook
- [ ] **File:** `deploy/ansible/playbooks/restore.yml`
- [ ] Add RustFS restore step (decrypt → extract → mc mirror back)
- [ ] Update `deploy/scripts/restore-postgres.sh` or create `restore-rustfs.sh`

### Step 1.5: Test
- [ ] Run backup in VM E2E environment
- [ ] Verify RustFS backup file created and encrypted
- [ ] Run restore and verify blob data recovered

---

## Phase 2: Backup Alerting

### Step 2.1: Add Backup Age Metric
- [ ] **File:** `src/server/routes/metrics.ts`
- [ ] Add `llamenos_backup_age_seconds` gauge
- [ ] Calculate from `.status.json` `lastSuccessAt` timestamp
- [ ] Add `llamenos_backup_size_bytes` gauge

### Step 2.2: Create Prometheus Alerting Rules
- [ ] **File:** `deploy/helm/llamenos/templates/prometheusrule.yaml` (create)
- [ ] `BackupTooOld`: alert when `llamenos_backup_age_seconds > 90000` (25 hours)
- [ ] `BackupSizeAnomaly`: alert when size drops >50% vs 24h ago
- [ ] `LlamenosDown`: alert when up metric missing for >5 minutes

### Step 2.3: Add Basic Docker Compose Alerting
- [ ] Create `deploy/scripts/check-backup-health.sh`
- [ ] Checks `.status.json` age, sends alert via curl to configured webhook
- [ ] Add as daily cron alongside backup

---

## Phase 3: Image Digest Pinning

### Step 3.1: Look Up Current Digests
- [ ] `docker pull ghcr.io/goauthentik/server:2025.12` → note SHA256
- [ ] `docker pull fedirz/faster-whisper-server:0.4.1` → note SHA256
- [ ] `docker pull rustfs/rustfs:latest` → note SHA256 and determine version tag
- [ ] `docker pull dockurr/strfry:latest` → note SHA256

### Step 3.2: Update Docker Compose
- [ ] **File:** `deploy/docker/docker-compose.yml`
- [ ] Pin Authentik, Whisper, RustFS, Strfry to `image@sha256:...`
- [ ] Add version comment above each image for reference

### Step 3.3: Update Helm Values
- [ ] **File:** `deploy/helm/llamenos/values.yaml`
- [ ] Pin Whisper, RustFS, Strfry to digests
- [ ] Remove TODO comments

### Step 3.4: Verify
- [ ] `docker compose -f deploy/docker/docker-compose.yml config` — verify image resolution
- [ ] `helm template deploy/helm/llamenos` — verify image references

---

## Phase 4: Application Metrics

### Step 4.1: Add HTTP Request Metrics
- [ ] **File:** `src/server/routes/metrics.ts`
- [ ] Add middleware to track: method, path prefix, status code, duration
- [ ] Export as `llamenos_http_requests_total` (counter) and `llamenos_http_request_duration_seconds` (histogram)

### Step 4.2: Add Application Metrics
- [ ] `llamenos_active_calls` gauge — from CallsService
- [ ] `llamenos_active_shifts` gauge — from ShiftsService
- [ ] `llamenos_uptime_seconds` — already exists

### Step 4.3: Create PrometheusRule
- [ ] **File:** `deploy/helm/llamenos/templates/prometheusrule.yaml`
- [ ] Alert: `HighErrorRate` — >5% 5xx in 5 minutes
- [ ] Alert: `HighLatency` — p95 >2s in 5 minutes
- [ ] Alert: `LlamenosDown` — target down >5 minutes
- [ ] Alert: `BackupTooOld` — backup age >25 hours

---

## Phase 5: Watchtower Hardening

### Step 5.1: Add Production Safeguards
- [ ] **File:** `deploy/docker/docker-compose.production.yml`
- [ ] Add `WATCHTOWER_SCHEDULE=0 0 4 * * *` (04:00 UTC daily)
- [ ] Add `WATCHTOWER_NOTIFICATION_URL` env var (optional, for Slack/Discord)
- [ ] Add `WATCHTOWER_NOTIFICATION_TEMPLATE` for formatted messages
- [ ] Document `WATCHTOWER_DRY_RUN=true` in `.env.example`

### Step 5.2: Update .env.example
- [ ] **File:** `deploy/docker/.env.example`
- [ ] Add Watchtower notification configuration section
- [ ] Document schedule customization

---

## Commit Strategy

- Phase 1 (RustFS backup): standalone commit
- Phase 2 (alerting): standalone commit
- Phase 3 (image pinning): standalone commit
- Phases 4-5 (metrics + Watchtower): can be combined
